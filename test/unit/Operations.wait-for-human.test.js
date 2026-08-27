/**
 * Unit tests for the wait_for_human runtime guard.
 *
 * Bug: the wait_for_human handler unconditionally blocked reading stdin.
 * When a page-wait was misclassified as wait_for_human and stdin was not a
 * TTY (headless CLI, n8n, `< /dev/null`), the line never arrived and the
 * process blocked indefinitely with no failure — the "2-minute silent hang".
 *
 * Guard contract:
 *  - stdin not a TTY and no opt-in  → fail the instruction fast with an
 *    actionable error (names the misclassification escape hatch and the
 *    IBR_WAIT_FOR_HUMAN_ALLOW_PIPED opt-in). Never opens readline.
 *  - stdin is a TTY                 → announce the pause on stderr and wait
 *    for ENTER (existing interactive behavior).
 *  - IBR_WAIT_FOR_HUMAN_ALLOW_PIPED=true → waits on piped stdin, but if
 *    stdin ends before a line arrives, reject instead of hanging forever.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');
vi.mock('../../src/utils/ariaSimplifier.js', () => ({
  getSnapshot: vi.fn().mockResolvedValue(''),
  assessQuality: vi.fn().mockReturnValue({ score: 1, isUsable: true }),
  selectMode: vi.fn().mockReturnValue('aria'),
  resolveElement: vi.fn(),
  SIZE_THRESHOLD: 200000,
  SPARSITY_THRESHOLD: 0.05,
  default: {
    getSnapshot: vi.fn().mockResolvedValue(''),
    assessQuality: vi.fn().mockReturnValue({ score: 1, isUsable: true }),
    selectMode: vi.fn().mockReturnValue('aria'),
    resolveElement: vi.fn(),
    SIZE_THRESHOLD: 200000,
    SPARSITY_THRESHOLD: 0.05,
  },
}));
vi.mock('readline', () => {
  const createInterface = vi.fn();
  return { default: { createInterface }, createInterface };
});

import readline from 'readline';
import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { Operations } from '../../src/Operations.js';

CacheManager.mockImplementation(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  generateKey: vi.fn().mockReturnValue('k'),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
}));

function makePage(html = '<html><head></head><body></body></html>') {
  return {
    content: vi.fn().mockResolvedValue(html),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(0),
    locator: vi.fn(),
    getByRole: vi.fn(),
    getByText: vi.fn(),
  };
}

function makeCtx(page) {
  return {
    aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
    page,
  };
}

function makeRlStub() {
  const rl = new EventEmitter();
  rl.close = vi.fn(() => rl.emit('close'));
  return rl;
}

const TASK = { url: 'https://example.com', instructions: [] };
const WAIT_HUMAN = { name: 'wait_for_human', prompt: 'wait for the page to load' };

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

function setIsTTY(value) {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

describe('wait_for_human runtime guard', () => {
  let ops, rlStub, warnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    generateAIResponse.mockResolvedValue({ content: '{}', usage: {} });
    rlStub = makeRlStub();
    readline.createInterface.mockReturnValue(rlStub);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.IBR_WAIT_FOR_HUMAN_ALLOW_PIPED;
    ops = new Operations(makeCtx(makePage()));
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.IBR_WAIT_FOR_HUMAN_ALLOW_PIPED;
    if (originalIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    } else {
      delete process.stdin.isTTY;
    }
  });

  describe('stdin is NOT a TTY (headless / piped / < /dev/null)', () => {
    beforeEach(() => setIsTTY(undefined));

    it('fails fast instead of blocking on stdin', { timeout: 3000 }, async () => {
      await expect(
        ops.executeTask({ ...TASK, instructions: [WAIT_HUMAN] })
      ).rejects.toThrow(/TTY/);
    });

    it('never opens a readline interface on stdin', { timeout: 3000 }, async () => {
      await ops.executeTask({ ...TASK, instructions: [WAIT_HUMAN] }).catch(() => {});
      expect(readline.createInterface).not.toHaveBeenCalled();
    });

    it('error is actionable: names the misclassification escape hatch and the opt-in env var', { timeout: 3000 }, async () => {
      const err = await ops
        .executeTask({ ...TASK, instructions: [WAIT_HUMAN] })
        .then(() => null, (e) => e);
      expect(err).toBeTruthy();
      // Points at the likely cause: a page/element wait misclassified as a human wait.
      expect(err.message).toMatch(/rephrase|timed wait|wait_for_human/i);
      // Names the explicit opt-in for piped-stdin waiting.
      expect(err.message).toContain('IBR_WAIT_FOR_HUMAN_ALLOW_PIPED');
    });
  });

  describe('stdin IS a TTY (interactive)', () => {
    beforeEach(() => setIsTTY(true));

    it('announces the pause on stderr and resumes on ENTER', { timeout: 3000 }, async () => {
      const p = ops.executeTask({ ...TASK, instructions: [WAIT_HUMAN] });
      await vi.waitFor(() => expect(readline.createInterface).toHaveBeenCalled());
      // The wait is announced, not mute (console.warn writes to stderr).
      const announced = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(announced).toMatch(/PAUSED/);
      expect(announced).toMatch(/ENTER/);
      rlStub.emit('line');
      await expect(p).resolves.toBeUndefined();
    });
  });

  describe('opt-in: IBR_WAIT_FOR_HUMAN_ALLOW_PIPED=true with piped stdin', () => {
    beforeEach(() => {
      setIsTTY(undefined);
      process.env.IBR_WAIT_FOR_HUMAN_ALLOW_PIPED = 'true';
    });

    it('waits on piped stdin and resumes when a line arrives', { timeout: 3000 }, async () => {
      const p = ops.executeTask({ ...TASK, instructions: [WAIT_HUMAN] });
      await vi.waitFor(() => expect(readline.createInterface).toHaveBeenCalled());
      rlStub.emit('line');
      await expect(p).resolves.toBeUndefined();
    });

    it('rejects (not hangs) if stdin ends before a line arrives', { timeout: 3000 }, async () => {
      const p = ops.executeTask({ ...TASK, instructions: [WAIT_HUMAN] });
      await vi.waitFor(() => expect(readline.createInterface).toHaveBeenCalled());
      rlStub.emit('close');
      await expect(p).rejects.toThrow(/stdin ended/i);
    });
  });
});
