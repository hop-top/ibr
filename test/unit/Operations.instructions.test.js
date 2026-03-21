/**
 * Unit tests for Operations instruction dispatch and execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');
// resolveElement is mocked so we can control what it returns per test.
// Default: return undefined so tests that need it failing can set mockReturnValue(null).
// Existing dispatch tests stub it to return a locator via the page fixture below.
vi.mock('../../src/utils/ariaSimplifier.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveElement: vi.fn() };
});

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { Operations } from '../../src/Operations.js';
import { resolveElement } from '../../src/utils/ariaSimplifier.js';

// ── stubs ─────────────────────────────────────────────────────────────────────

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

const TASK = {
  url: 'https://example.com',
  instructions: [],
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Operations instruction dispatch', () => {
  let page, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    page = makePage();
    ops = new Operations(makeCtx(page));
    // Default: resolveElement returns the page's shared locator instance
    // (mirrors what the real ariaSimplifier.resolveElement does for role-based descriptors)
    resolveElement.mockReturnValue(page._locatorInstance);
  });

  // ── executeTask: navigation ─────────────────────────────────────────────────

  describe('executeTask()', () => {
    it('calls page.goto with the task url', async () => {
      generateAIResponse.mockResolvedValue(aiResp('{}'));
      await ops.executeTask({ ...TASK, instructions: [] });
      expect(page.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle',
      });
    });
  });

  // ── dispatch: unknown instruction ───────────────────────────────────────────

  describe('unknown instruction', () => {
    it('throws "Unknown instruction type" for unrecognised name', async () => {
      await expect(
        ops.executeTask({
          ...TASK,
          instructions: [{ name: 'teleport', prompt: 'somewhere' }],
        })
      ).rejects.toThrow('Unknown instruction type: "teleport"');
    });
  });

  // ── dispatch: action types ──────────────────────────────────────────────────

  describe('actionInstruction dispatch', () => {
    const actionResponse = JSON.stringify({
      elements: [{ role: 'button', name: 'Submit' }],
      type: 'click',
    });

    it('calls locator.click() for click instruction', async () => {
      generateAIResponse.mockResolvedValue(aiResp(actionResponse));
      await ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'btn' }] });
      expect(page._locatorInstance.click).toHaveBeenCalled();
    });

    it('calls locator.fill() for fill instruction', async () => {
      const resp = JSON.stringify({ elements: [{ role: 'textbox', name: 'Email' }], type: 'fill', value: 'hello' });
      generateAIResponse.mockResolvedValue(aiResp(resp));
      await ops.executeTask({ ...TASK, instructions: [{ name: 'fill', prompt: 'input' }] });
      expect(page._locatorInstance.fill).toHaveBeenCalledWith('hello');
    });

    it('calls locator.type() for type instruction', async () => {
      const resp = JSON.stringify({ elements: [{ role: 'textbox', name: 'Search' }], type: 'type', value: 'abc' });
      generateAIResponse.mockResolvedValue(aiResp(resp));
      await ops.executeTask({ ...TASK, instructions: [{ name: 'type', prompt: 'input' }] });
      expect(page._locatorInstance.type).toHaveBeenCalledWith('abc');
    });

    it('calls locator.press() for press instruction', async () => {
      const resp = JSON.stringify({ elements: [{ role: 'textbox', name: 'Query' }], type: 'press', value: 'Enter' });
      generateAIResponse.mockResolvedValue(aiResp(resp));
      await ops.executeTask({ ...TASK, instructions: [{ name: 'press', prompt: 'key' }] });
      expect(page._locatorInstance.press).toHaveBeenCalledWith('Enter');
    });

    it('is a no-op (no throw) when AI returns no elements — story 003', async () => {
      const resp = JSON.stringify({ elements: [], type: 'click' });
      generateAIResponse.mockResolvedValue(aiResp(resp));
      await expect(
        ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'missing' }] })
      ).resolves.not.toThrow();
      expect(page._locatorInstance.click).not.toHaveBeenCalled();
    });
  });

  // ── extractInstruction ───────────────────────────────────────────────────────

  describe('extractInstruction', () => {
    it('calls domSimplifier and stores result in this.extracts', async () => {
      const data = [{ name: 'Widget A', price: '$9.99' }];
      generateAIResponse.mockResolvedValue(aiResp(JSON.stringify(data)));

      await ops.executeTask({
        ...TASK,
        instructions: [{ name: 'extract', prompt: 'product names and prices' }],
      });

      expect(ops.extracts).toHaveLength(1);
    });

    it('sends AI response to extracts even when response is empty array', async () => {
      generateAIResponse.mockResolvedValue(aiResp(JSON.stringify([])));
      await ops.executeTask({
        ...TASK,
        instructions: [{ name: 'extract', prompt: 'nada' }],
      });
      expect(ops.extracts).toHaveLength(1);
    });
  });

  // ── scroll instruction ───────────────────────────────────────────────────────

  describe('scroll instruction', () => {
    it('dispatches scroll to actionInstruction (no-op if no elements)', async () => {
      generateAIResponse.mockResolvedValue(aiResp(JSON.stringify({ elements: [] })));
      await expect(
        ops.executeTask({ ...TASK, instructions: [{ name: 'scroll', prompt: 'down' }] })
      ).resolves.not.toThrow();
    });
  });

  // ── high-precision error messages (T-0013) ───────────────────────────────────

  describe('Unable to resolve element descriptor — high-precision error', () => {
    it('throws with ibr snap suggestion when resolveElement returns null', async () => {
      // AI returns a role-based descriptor (aria mode path: resolveElement called)
      const actionResp = JSON.stringify({
        elements: [{ role: 'button', name: 'Ghost' }],
        type: 'click',
      });
      generateAIResponse.mockResolvedValue(aiResp(actionResp));
      // Make resolveElement return null so the descriptor cannot be resolved
      resolveElement.mockReturnValue(null);

      await expect(
        ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'ghost btn' }] })
      ).rejects.toThrow('Unable to resolve element descriptor');
    });

    it('includes ibr snap -i hint in the error', async () => {
      const actionResp = JSON.stringify({
        elements: [{ role: 'button', name: 'Ghost' }],
        type: 'click',
      });
      generateAIResponse.mockResolvedValue(aiResp(actionResp));
      resolveElement.mockReturnValue(null);

      await expect(
        ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'ghost btn' }] })
      ).rejects.toThrow('ibr snap <url> -i');
    });

    it('error mentions inspecting @refs', async () => {
      const actionResp = JSON.stringify({
        elements: [{ role: 'button', name: 'Ghost' }],
        type: 'click',
      });
      generateAIResponse.mockResolvedValue(aiResp(actionResp));
      resolveElement.mockReturnValue(null);

      await expect(
        ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'ghost btn' }] })
      ).rejects.toThrow('@refs');
    });
  });

  describe('Failed to execute action — high-precision error', () => {
    it('throws with hidden/disabled/covered hint when click fails', async () => {
      const actionResp = JSON.stringify({
        elements: [{ role: 'button', name: 'Submit' }],
        type: 'click',
      });
      generateAIResponse.mockResolvedValue(aiResp(actionResp));
      // resolveElement returns a valid locator but click throws
      const failingLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockRejectedValue(new Error('element is not visible')),
        fill: vi.fn(),
        type: vi.fn(),
        press: vi.fn(),
        ariaSnapshot: vi.fn().mockResolvedValue('- button "Submit"'),
      };
      resolveElement.mockReturnValue(failingLocator);

      await expect(
        ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] })
      ).rejects.toThrow('hidden, disabled, or covered by another element');
    });

    it('includes ibr snap page state hint in action failure', async () => {
      const actionResp = JSON.stringify({
        elements: [{ role: 'button', name: 'Submit' }],
        type: 'click',
      });
      generateAIResponse.mockResolvedValue(aiResp(actionResp));
      const failingLocator = {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockRejectedValue(new Error('not clickable')),
        fill: vi.fn(),
        type: vi.fn(),
        press: vi.fn(),
        ariaSnapshot: vi.fn().mockResolvedValue('- button "Submit"'),
      };
      resolveElement.mockReturnValue(failingLocator);

      await expect(
        ops.executeTask({ ...TASK, instructions: [{ name: 'click', prompt: 'submit' }] })
      ).rejects.toThrow('ibr snap <url> -i');
    });
  });
});
