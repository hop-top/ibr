/**
 * Unit tests for Operations cache behaviour (actionInstruction + findElements)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { Operations } from '../../src/Operations.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function aiResp(content) {
  return { content, usage: { promptTokens: 5, completionTokens: 3 } };
}

function makePage(html = '<html><head></head><body></body></html>') {
  const locator = {
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    ariaSnapshot: vi.fn().mockResolvedValue('- button "Submit"'),
  };
  return {
    content: vi.fn().mockResolvedValue(html),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(0),
    locator: vi.fn().mockReturnValue(locator),
    getByRole: vi.fn().mockReturnValue(locator),
    getByLabel: vi.fn().mockReturnValue(locator),
    getByText: vi.fn().mockReturnValue(locator),
    getByPlaceholder: vi.fn().mockReturnValue(locator),
    _locator: locator,
  };
}

function makeCtx(page) {
  return {
    aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
    page,
  };
}

const BASE_TASK = { url: 'https://example.com', instructions: [] };
const CLICK_RESP = JSON.stringify({ elements: [{ role: 'button', name: 'Submit' }], type: 'click' });
const FOUND_RESP = JSON.stringify([{ role: 'button', name: 'Submit' }]);

// ── actionInstruction cache tests ─────────────────────────────────────────────

describe('Operations cache – actionInstruction', () => {
  let page, mockCache, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    page = makePage();
  });

  it('cache miss: calls AI and sets cache', async () => {
    const setCacheFn = vi.fn().mockResolvedValue(undefined);
    CacheManager.mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      generateKey: vi.fn().mockReturnValue('k1'),
      get: vi.fn().mockResolvedValue(null),          // cache MISS
      set: setCacheFn,
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    }));

    ops = new Operations(makeCtx(page));
    generateAIResponse.mockResolvedValue(aiResp(CLICK_RESP));

    await ops.executeTask({
      ...BASE_TASK,
      instructions: [{ name: 'click', prompt: 'submit' }],
    });

    expect(generateAIResponse).toHaveBeenCalled();
    expect(setCacheFn).toHaveBeenCalled();
  });

  it('cache hit with compatible DOM: skips AI call', async () => {
    // The DOM sig from createDomSignature is a sha256 hash; we use the same
    // value for both cached and current so isDomCompatible returns true.
    // We mock the cache to return a valid hit entry.

    // We can't easily control the exact hash produced, so we patch
    // isDomCompatible via the same DOM signature approach:
    // store same sig string in cached.metadata and generate matching current sig
    // by providing identical DOM content.

    // Simpler approach: make cached.metadata.lastDomSignature = null so
    // isDomCompatible returns true regardless.
    const cachedEntry = {
      schema: {
        elementDescriptors: [{ role: 'button', name: 'Submit' }],
        actionType: 'click',
        actionValue: null,
      },
      metadata: {
        lastDomSignature: null, // null → always compatible
        failureCount: 0,
      },
    };

    const recordSuccessFn = vi.fn().mockResolvedValue(undefined);
    CacheManager.mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      generateKey: vi.fn().mockReturnValue('k2'),
      get: vi.fn().mockResolvedValue(cachedEntry),    // cache HIT
      set: vi.fn().mockResolvedValue(undefined),
      recordSuccess: recordSuccessFn,
      recordFailure: vi.fn().mockResolvedValue(undefined),
    }));

    ops = new Operations(makeCtx(page));

    await ops.executeTask({
      ...BASE_TASK,
      instructions: [{ name: 'click', prompt: 'submit' }],
    });

    // AI must NOT have been called for the action
    expect(generateAIResponse).not.toHaveBeenCalled();
    expect(recordSuccessFn).toHaveBeenCalled();
  });

  it('cache hit with incompatible DOM: calls AI again', async () => {
    // sig_old ≠ sig_new → isDomCompatible returns false
    const cachedEntry = {
      schema: {
        elementDescriptors: [{ role: 'button', name: 'Submit' }],
        actionType: 'click',
        actionValue: null,
      },
      metadata: {
        lastDomSignature: 'aaaa_old_sig',
        failureCount: 0,
      },
    };

    // We need to ensure the DOM produces a DIFFERENT sig.
    // Since createDomSignature hashes real structure, any non-null value
    // will differ from 'aaaa_old_sig'. The page DOM is non-trivial (it
    // has html/head/body), so the real hash will differ.

    CacheManager.mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      generateKey: vi.fn().mockReturnValue('k3'),
      get: vi.fn().mockResolvedValue(cachedEntry),
      set: vi.fn().mockResolvedValue(undefined),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    }));

    ops = new Operations(makeCtx(page));
    generateAIResponse.mockResolvedValue(aiResp(CLICK_RESP));

    await ops.executeTask({
      ...BASE_TASK,
      instructions: [{ name: 'click', prompt: 'submit' }],
    });

    // AI should be called because DOM changed
    expect(generateAIResponse).toHaveBeenCalled();
  });
});

// ── findElements cache tests ──────────────────────────────────────────────────

describe('Operations cache – findElements (via conditionInstruction)', () => {
  let page, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    page = makePage();
  });

  it('cache miss: calls AI for find', async () => {
    CacheManager.mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      generateKey: vi.fn().mockReturnValue('fk1'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    }));

    ops = new Operations(makeCtx(page));
    generateAIResponse.mockResolvedValue(aiResp(FOUND_RESP));

    await ops.executeTask({
      ...BASE_TASK,
      instructions: [{
        name: 'condition',
        prompt: 'button',
        success_instructions: [],
        failure_instructions: [],
      }],
    });

    expect(generateAIResponse).toHaveBeenCalledTimes(1);
  });

  it('cache hit: returns cached elements without AI call', async () => {
    const cachedEntry = {
      schema: { elementDescriptors: [{ role: 'button', name: 'Submit' }] },
      metadata: {
        lastDomSignature: null,
        failureCount: 0,
      },
    };

    CacheManager.mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      generateKey: vi.fn().mockReturnValue('fk2'),
      get: vi.fn().mockResolvedValue(cachedEntry),
      set: vi.fn().mockResolvedValue(undefined),
      recordSuccess: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    }));

    ops = new Operations(makeCtx(page));

    await ops.executeTask({
      ...BASE_TASK,
      instructions: [{
        name: 'condition',
        prompt: 'button',
        success_instructions: [],
        failure_instructions: [],
      }],
    });

    // No AI call — served from cache
    expect(generateAIResponse).not.toHaveBeenCalled();
  });
});
