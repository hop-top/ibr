/**
 * Regression (T-0115): the LLM parser sometimes splits a verdict instruction
 * ("report PAGE_OK if the heading is shown, or PAGE_FAILED …") into a CONDITION
 * instruction plus a BARE extract whose prompt is just the token ("PAGE_OK") on
 * the success path (and the failure token on the failure path).
 *
 * That child extract prompt carries no report verb, so the extract system prompt
 * (makeExtractInstructionMessage) framed it as ordinary page-data extraction and
 * the model returned literal [] — the verdict was lost, even though the parser
 * (T-0110) and the report-phrased prompt path (T-0111) already handle the other
 * two split shapes.
 *
 * Fix: isVerdictExtractPrompt recognises a bare uppercase status token as verdict
 * intent (no verb required), so the split child extract carries verdict guidance.
 * GIVEN that corrected prompt, the model emits the verdict object, the T-0110
 * parser normalises it, and it reaches ops.extracts — deterministically,
 * regardless of which way the LLM split the instruction.
 *
 * This drives the real (unmocked) prompt builder and mocks only the AI response
 * to the shape the corrected prompt elicits — never a live model.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { makeExtractInstructionMessage } from '../../src/utils/prompts.js';
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

describe('Operations — condition-split verdict (bare token child extract)', () => {
  let page, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    page = makePage();
    ops = new Operations(makeCtx(page));
  });

  it('the bare-token child extract prompt carries verdict-emitting guidance', () => {
    // Guards the prompt seam directly: the real builder must inject the verdict
    // block for a split child whose prompt is just "PAGE_OK" (RED before the fix).
    const sys = makeExtractInstructionMessage('PAGE_OK', '- heading "Example Domain"')[0].content;
    expect(sys.toLowerCase()).toContain('verdict');
  });

  it('condition TRUE → bare success-path extract "PAGE_OK" reaches ops.extracts', async () => {
    // GIVEN the corrected prompt, the model returns the verdict object for the
    // bare-token extract (the shape VERDICT_EXTRACT_GUIDANCE elicits).
    generateAIResponse
      .mockResolvedValueOnce(aiResp(FOUND))                              // condition find → TRUE
      .mockResolvedValueOnce(aiResp(JSON.stringify({ verdict: 'PAGE_OK' }))); // split child extract

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'the heading "Example Domain" is shown',
        // condition-split shape: bare token, NO report verb.
        success_instructions: [{ name: 'extract', prompt: 'PAGE_OK' }],
        failure_instructions: [{ name: 'extract', prompt: 'PAGE_FAILED' }],
      }],
    });

    // The verdict must survive — NOT the nested empty array [ [] ] the bug produced.
    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).not.toEqual([]);
    expect(ops.extracts[0]).toEqual([{ verdict: 'PAGE_OK' }]);
  });

  it('condition FALSE → bare failure-path extract "PAGE_FAILED" reaches ops.extracts', async () => {
    generateAIResponse
      .mockResolvedValueOnce(aiResp(NOT_FOUND))                             // condition find → FALSE
      .mockResolvedValueOnce(aiResp(JSON.stringify({ verdict: 'PAGE_FAILED' }))); // split child extract

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'the heading "Example Domain" is shown',
        success_instructions: [{ name: 'extract', prompt: 'PAGE_OK' }],
        failure_instructions: [{ name: 'extract', prompt: 'PAGE_FAILED' }],
      }],
    });

    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).toEqual([{ verdict: 'PAGE_FAILED' }]);
  });

  it('condition TRUE → bare success-path extract as a scalar token reaches ops.extracts', async () => {
    generateAIResponse
      .mockResolvedValueOnce(aiResp(FOUND))                      // condition find → TRUE
      .mockResolvedValueOnce(aiResp(JSON.stringify('PAGE_OK'))); // split child extract (JSON string)

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{
        name: 'condition',
        prompt: 'heading shown',
        success_instructions: [{ name: 'extract', prompt: 'PAGE_OK' }],
        failure_instructions: [{ name: 'extract', prompt: 'PAGE_FAILED' }],
      }],
    });

    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).toEqual(['PAGE_OK']);
  });
});
