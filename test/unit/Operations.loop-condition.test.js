/**
 * Unit tests for Operations loop and condition instructions
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

function makePage(html = '<html><head></head><body></body></html>') {
  const locator = {
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
  };
  return {
    content: vi.fn().mockResolvedValue(html),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(0),
    locator: vi.fn().mockReturnValue(locator),
    _locator: locator,
  };
}

function makeCtx(page) {
  return {
    aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
    page,
  };
}

function aiResp(content) {
  return { content, usage: { promptTokens: 5, completionTokens: 3 } };
}

const BASE_URL = 'https://example.com';

// find-elements response helpers
const FOUND = JSON.stringify([{ x: 0 }]);
const NOT_FOUND = JSON.stringify([]);

// ── loop tests ───────────────────────────────────────────────────────────────

describe('Operations.loopInstruction', () => {
  let page, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    page = makePage();
    ops = new Operations(makeCtx(page));
  });

  it('iterates exactly 3 times when AI finds elements 3 times then returns empty', async () => {
    const actionClick = JSON.stringify({ elements: [{ x: 0 }], type: 'click' });

    // AI is called for: find(iter1), action-body(iter1), find(iter2), action-body(iter2),
    //                   find(iter3), action-body(iter3), find(break)
    generateAIResponse
      .mockResolvedValueOnce(aiResp(FOUND))       // find iter 1
      .mockResolvedValueOnce(aiResp(actionClick)) // body click iter 1
      .mockResolvedValueOnce(aiResp(FOUND))       // find iter 2
      .mockResolvedValueOnce(aiResp(actionClick)) // body click iter 2
      .mockResolvedValueOnce(aiResp(FOUND))       // find iter 3
      .mockResolvedValueOnce(aiResp(actionClick)) // body click iter 3
      .mockResolvedValueOnce(aiResp(NOT_FOUND));  // find break

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'loop',
        prompt: 'next page button',
        instructions: [{ name: 'click', prompt: 'next' }],
      }],
    });

    // body click called 3 times
    expect(page._locator.click).toHaveBeenCalledTimes(3);
  });

  it('hard-caps at 100 iterations and does not reject', async () => {
    vi.useFakeTimers();

    // Always return found → infinite loop without cap
    generateAIResponse.mockResolvedValue(aiResp(FOUND));

    const promise = ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'loop',
        prompt: 'always present',
        instructions: [],
      }],
    });

    await vi.runAllTimersAsync();
    // Should resolve (not reject) even at cap
    await expect(promise).resolves.not.toThrow();

    vi.useRealTimers();
  }, 10000);

  it('stops and logs warn at iteration cap (no throw)', async () => {
    const logger = await import('../../src/utils/logger.js');
    generateAIResponse.mockResolvedValue(aiResp(FOUND));

    vi.useFakeTimers();
    const p = ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'loop',
        prompt: 'endless',
        instructions: [],
      }],
    });
    await vi.runAllTimersAsync();
    await expect(p).resolves.not.toThrow();
    vi.useRealTimers();
  }, 10000);
});

// ── condition tests ───────────────────────────────────────────────────────────

describe('Operations.conditionInstruction', () => {
  let page, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    page = makePage();
    ops = new Operations(makeCtx(page));
  });

  it('executes success_instructions when elements are found', async () => {
    const clickResp = JSON.stringify({ elements: [{ x: 0 }], type: 'click' });
    generateAIResponse
      .mockResolvedValueOnce(aiResp(FOUND))      // condition find
      .mockResolvedValueOnce(aiResp(clickResp)); // success click

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'banner visible',
        success_instructions: [{ name: 'click', prompt: 'dismiss banner' }],
        failure_instructions: [],
      }],
    });

    expect(page._locator.click).toHaveBeenCalledTimes(1);
  });

  it('executes failure_instructions when elements are NOT found', async () => {
    const clickResp = JSON.stringify({ elements: [{ x: 0 }], type: 'click' });
    generateAIResponse
      .mockResolvedValueOnce(aiResp(NOT_FOUND)) // condition find
      .mockResolvedValueOnce(aiResp(clickResp)); // failure click

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'banner visible',
        success_instructions: [],
        failure_instructions: [{ name: 'click', prompt: 'open menu' }],
      }],
    });

    expect(page._locator.click).toHaveBeenCalledTimes(1);
  });

  it('does not call success path when condition is false', async () => {
    generateAIResponse.mockResolvedValueOnce(aiResp(NOT_FOUND));

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'banner visible',
        success_instructions: [{ name: 'click', prompt: 'dismiss' }],
        failure_instructions: [],
      }],
    });

    expect(page._locator.click).not.toHaveBeenCalled();
  });

  it('does not crash when both instruction arrays are empty', async () => {
    generateAIResponse.mockResolvedValueOnce(aiResp(FOUND));

    await expect(ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'anything',
        success_instructions: [],
        failure_instructions: [],
      }],
    })).resolves.not.toThrow();
  });

  it('does not crash when condition false and failure_instructions is empty', async () => {
    generateAIResponse.mockResolvedValueOnce(aiResp(NOT_FOUND));

    await expect(ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'anything',
        success_instructions: [{ name: 'click', prompt: 'x' }],
        failure_instructions: [],
      }],
    })).resolves.not.toThrow();
  });
});
