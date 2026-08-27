/**
 * Unit tests for long-run progress feedback wiring in Operations.executeTask.
 *
 * Asserts ProgressFeedback.advance() fires exactly once per TOP-LEVEL
 * instruction (nested condition/loop bodies must NOT inflate the count),
 * finish/fail fire on completion/error, and nothing is written to stdout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Spy on the ProgressFeedback seam. Preserve real behavior but wrap the
// instance methods so we can assert call counts and arguments.
const advanceSpy = vi.fn();
const finishSpy = vi.fn();
const failSpy = vi.fn();
vi.mock('../../src/observability/ProgressFeedback.js', () => {
  return {
    ProgressFeedback: class {
      constructor(opts) {
        this.opts = opts;
      }
      get enabled() { return true; }
      advance(instruction) { advanceSpy(instruction); }
      finish(msg) { finishSpy(msg); }
      fail(msg) { failSpy(msg); }
    },
  };
});

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { Operations } from '../../src/Operations.js';
import { resolveElement } from '../../src/utils/ariaSimplifier.js';

CacheManager.mockImplementation(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  generateKey: vi.fn().mockReturnValue('k'),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
}));

function makeLocator() {
  const loc = {
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1),
    ariaSnapshot: vi.fn().mockResolvedValue('- button "Submit"'),
  };
  return loc;
}

function makePage(html = '<html><head></head><body></body></html>') {
  const locatorInstance = makeLocator();
  return {
    content: vi.fn().mockResolvedValue(html),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(0),
    locator: vi.fn().mockReturnValue(locatorInstance),
    getByRole: vi.fn().mockReturnValue(locatorInstance),
    getByLabel: vi.fn().mockReturnValue(locatorInstance),
    getByText: vi.fn().mockReturnValue(locatorInstance),
    getByPlaceholder: vi.fn().mockReturnValue(locatorInstance),
    _locatorInstance: locatorInstance,
  };
}

function makeCtx(page) {
  return {
    aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
    page,
  };
}

function aiResp(content, p = 5, c = 3) {
  return { content, usage: { promptTokens: p, completionTokens: c } };
}

const TASK = { url: 'https://example.com', instructions: [] };

describe('Operations progress feedback wiring', () => {
  let page, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    advanceSpy.mockClear();
    finishSpy.mockClear();
    failSpy.mockClear();
    page = makePage();
    ops = new Operations(makeCtx(page));
    resolveElement.mockReturnValue(page._locatorInstance);
  });

  it('advances progress exactly once per top-level instruction', async () => {
    const clickResp = JSON.stringify({ elements: [{ role: 'button', name: 'Submit' }], type: 'click' });
    generateAIResponse.mockResolvedValue(aiResp(clickResp));
    await ops.executeTask({
      ...TASK,
      instructions: [
        { name: 'click', prompt: 'first' },
        { name: 'click', prompt: 'second' },
        { name: 'click', prompt: 'third' },
      ],
    });
    expect(advanceSpy).toHaveBeenCalledTimes(3);
    // advance receives the instruction (so a label can be derived)
    expect(advanceSpy.mock.calls[0][0]).toMatchObject({ name: 'click', prompt: 'first' });
    expect(advanceSpy.mock.calls[2][0]).toMatchObject({ name: 'click', prompt: 'third' });
  });

  it('finishes progress once on success', async () => {
    generateAIResponse.mockResolvedValue(aiResp('{}'));
    await ops.executeTask({ ...TASK, instructions: [] });
    expect(finishSpy).toHaveBeenCalledTimes(1);
    expect(failSpy).not.toHaveBeenCalled();
  });

  it('fails progress on error', async () => {
    await expect(
      ops.executeTask({ ...TASK, instructions: [{ name: 'teleport', prompt: 'nope' }] })
    ).rejects.toThrow('Unknown instruction type');
    expect(failSpy).toHaveBeenCalledTimes(1);
    expect(finishSpy).not.toHaveBeenCalled();
  });

  it('does NOT advance progress for nested condition-body instructions', async () => {
    // condition instruction whose success path runs 2 nested instructions.
    // #findElements returns elements (truthy) → success path taken; nested
    // clicks execute but must NOT advance the top-level n/N.
    const findClickResp = JSON.stringify({ elements: [{ role: 'button', name: 'X' }], type: 'click' });
    generateAIResponse.mockResolvedValue(aiResp(findClickResp));
    // Two top-level instructions: one condition (with 2 nested clicks) + one click.
    await ops.executeTask({
      ...TASK,
      instructions: [
        {
          name: 'condition',
          prompt: 'if logged in',
          success_instructions: [
            { name: 'click', prompt: 'nested-a' },
            { name: 'click', prompt: 'nested-b' },
          ],
          failure_instructions: [],
        },
        { name: 'click', prompt: 'final' },
      ],
    });
    // Only the 2 TOP-LEVEL instructions advance progress, not the nested ones.
    expect(advanceSpy).toHaveBeenCalledTimes(2);
  });
});

describe('Operations progress — stdout discipline (real ProgressFeedback)', () => {
  // Re-import Operations with the REAL ProgressFeedback (unmock) to prove
  // progress writes never land on stdout.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes nothing to stdout during a run', async () => {
    vi.resetModules();
    vi.doUnmock('../../src/observability/ProgressFeedback.js');
    // Re-establish the other mocks after resetModules.
    vi.doMock('../../src/ai/provider.js');
    vi.doMock('../../src/cache/CacheManager.js');
    vi.doMock('../../src/utils/logger.js');
    vi.doMock('../../src/utils/ariaSimplifier.js', () => ({
      getSnapshot: vi.fn().mockResolvedValue(''),
      assessQuality: vi.fn().mockReturnValue({ score: 1, isUsable: true }),
      selectMode: vi.fn().mockReturnValue('aria'),
      resolveElement: vi.fn(),
      SIZE_THRESHOLD: 200000,
      SPARSITY_THRESHOLD: 0.05,
      default: {},
    }));

    const { generateAIResponse: gen } = await import('../../src/ai/provider.js');
    const { CacheManager: CM } = await import('../../src/cache/CacheManager.js');
    const { Operations: Ops } = await import('../../src/Operations.js');
    const { resolveElement: resolve } = await import('../../src/utils/ariaSimplifier.js');

    CM.mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      generateKey: vi.fn().mockReturnValue('k'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    }));

    const page = makePage();
    resolve.mockReturnValue(page._locatorInstance);
    const clickResp = JSON.stringify({ elements: [{ role: 'button', name: 'Submit' }], type: 'click' });
    gen.mockResolvedValue(aiResp(clickResp));

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const ops = new Ops(makeCtx(page));
      await ops.executeTask({
        ...TASK,
        instructions: [
          { name: 'click', prompt: 'first' },
          { name: 'click', prompt: 'second' },
        ],
      });
      expect(stdoutSpy).not.toHaveBeenCalled();
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});
