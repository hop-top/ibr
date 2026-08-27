/**
 * Regression (prompt-layer half of the lost-verdict bug): a verdict/report-style
 * extract instruction ("report PAGE_OK if the heading is shown, or PAGE_FAILED
 * with the error") must yield the verdict token in the task's final extracts.
 *
 * Root cause: the extract system prompt (makeExtractInstructionMessage) framed
 * the task as "extract data FROM THE PAGE; return [] if nothing found". A verdict
 * has no page-data to scrape, so the model correctly emitted literal [] — the
 * verdict was lost at the SOURCE, before any parser could help.
 *
 * Fix (Option A, prompt-only): the extract prompt now detects verdict/report
 * intent and instructs the model to emit the verdict token as a one-record data
 * payload. GIVEN that corrected prompt, the model returns {"verdict":"PAGE_OK"},
 * which the T-0110 parser fix normalises to [{verdict:'PAGE_OK'}] and pushes to
 * ops.extracts. This test drives the real (unmocked) prompt builder and asserts
 * the propagation end to end — the AI response is mocked to the shape the
 * corrected prompt elicits, never a live model.
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
const VERDICT_PROMPT =
  'report PAGE_OK if the heading "Example Domain" is shown, or PAGE_FAILED with the exact error text';

describe('Operations — verdict-style extract propagates the verdict', () => {
  let page, ops;

  beforeEach(() => {
    vi.clearAllMocks();
    page = makePage();
    ops = new Operations(makeCtx(page));
  });

  it('the extract prompt for a verdict instruction carries verdict-emitting guidance', () => {
    // Guards the prompt seam directly: the real builder must inject the verdict
    // block for this instruction (RED before the prompts.js fix).
    const sys = makeExtractInstructionMessage(VERDICT_PROMPT, '- heading "Example Domain"')[0].content;
    expect(sys.toLowerCase()).toContain('verdict');
  });

  it('plain extract of a verdict → PAGE_OK reaches ops.extracts (not [ [] ])', async () => {
    // GIVEN the corrected prompt, the model returns the verdict object.
    generateAIResponse.mockResolvedValueOnce(aiResp(JSON.stringify({ verdict: 'PAGE_OK' })));

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{ name: 'extract', prompt: VERDICT_PROMPT }],
    });

    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).not.toEqual([]);
    expect(ops.extracts[0]).toEqual([{ verdict: 'PAGE_OK' }]);
  });

  it('plain extract of a scalar verdict token reaches ops.extracts', async () => {
    generateAIResponse.mockResolvedValueOnce(aiResp(JSON.stringify('LOGIN_FAILED')));

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{ name: 'extract', prompt: 'return LOGIN_OK or LOGIN_FAILED' }],
    });

    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).toEqual(['LOGIN_FAILED']);
  });

  it('a normal data extract is unaffected — still scrapes page data', async () => {
    generateAIResponse.mockResolvedValueOnce(
      aiResp(JSON.stringify([{ price: '$9.99' }, { price: '$19.99' }]))
    );

    await ops.executeTask({
      url: BASE_URL,
      instructions: [{ name: 'extract', prompt: 'extract the price of each product' }],
    });

    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).toEqual([{ price: '$9.99' }, { price: '$19.99' }]);
  });
});
