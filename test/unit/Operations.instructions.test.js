/**
 * Unit tests for Operations instruction dispatch and execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { Operations } from '../../src/Operations.js';

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
      ).rejects.toThrow('Unknown instruction type: teleport');
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
});
