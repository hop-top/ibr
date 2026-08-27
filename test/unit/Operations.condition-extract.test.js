/**
 * Regression: extract on a condition success/failure path must propagate its
 * payload to the task's final extracts output.
 *
 * Bug: a condition whose success branch runs an extract for a verdict
 * ("report PAGE_OK …") lost the verdict. #findElements matched (elementCount 1),
 * the success path ran the extract, but parseExtractionResponse discarded a
 * non-array / non-{data:[]} payload (a plain verdict object, or a bare scalar)
 * to [], so ops.extracts came out [ [] ] — a nested empty array, verdict gone.
 *
 * The extract shares this.extracts with the parent loop, so the loss is in the
 * extraction-payload normalisation, not the condition wiring; the condition
 * success path is just where the repro surfaces it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');

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
  const locator = {
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1),
    ariaSnapshot: vi.fn().mockResolvedValue('- heading "Example Domain"'),
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

function aiResp(content) {
  return { content, usage: { promptTokens: 5, completionTokens: 3 } };
}

const BASE_URL = 'https://example.com';
const FOUND = JSON.stringify([{ role: 'heading', name: 'Example Domain' }]);
const NOT_FOUND = JSON.stringify([]);

describe('Operations — extract on condition path propagates verdict', () => {
  let page, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    page = makePage();
    ops = new Operations(makeCtx(page));
  });

  it('condition TRUE → success-path extract of a verdict object reaches ops.extracts', async () => {
    // model returns a single verdict object for "report PAGE_OK …"
    const VERDICT = JSON.stringify({ verdict: 'PAGE_OK' });

    generateAIResponse
      .mockResolvedValueOnce(aiResp(FOUND))    // condition find → elementCount 1
      .mockResolvedValueOnce(aiResp(VERDICT)); // success-path extract

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'heading "Example Domain" is shown',
        success_instructions: [{ name: 'extract', prompt: 'report PAGE_OK' }],
        failure_instructions: [],
      }],
    });

    // one extract instruction ran → one inner array
    expect(ops.extracts).toHaveLength(1);
    // the verdict must survive — NOT a nested empty array [ [] ]
    expect(ops.extracts[0]).not.toEqual([]);
    expect(ops.extracts[0]).toEqual([{ verdict: 'PAGE_OK' }]);
  });

  it('condition TRUE → success-path extract of a scalar verdict reaches ops.extracts', async () => {
    // model returns a JSON string verdict for "report PAGE_OK"
    generateAIResponse
      .mockResolvedValueOnce(aiResp(FOUND))                    // condition find → elementCount 1
      .mockResolvedValueOnce(aiResp(JSON.stringify('PAGE_OK'))); // success-path extract (JSON string)

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'heading shown',
        success_instructions: [{ name: 'extract', prompt: 'report PAGE_OK' }],
        failure_instructions: [],
      }],
    });

    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).not.toEqual([]);
    expect(ops.extracts[0]).toEqual(['PAGE_OK']);
  });

  it('condition FALSE → failure-path extract of a verdict object reaches ops.extracts', async () => {
    const VERDICT = JSON.stringify({ verdict: 'PAGE_FAILED' });

    generateAIResponse
      .mockResolvedValueOnce(aiResp(NOT_FOUND)) // condition find → elementCount 0
      .mockResolvedValueOnce(aiResp(VERDICT));  // failure-path extract

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'heading shown',
        success_instructions: [],
        failure_instructions: [{ name: 'extract', prompt: 'report PAGE_FAILED' }],
      }],
    });

    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).toEqual([{ verdict: 'PAGE_FAILED' }]);
  });

  it('genuinely empty extract still yields an empty inner array (no false verdict)', async () => {
    generateAIResponse
      .mockResolvedValueOnce(aiResp(FOUND))            // condition find
      .mockResolvedValueOnce(aiResp(JSON.stringify([]))); // extract → truly empty

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'heading shown',
        success_instructions: [{ name: 'extract', prompt: 'nothing here' }],
        failure_instructions: [],
      }],
    });

    expect(ops.extracts).toEqual([[]]);
  });
});
