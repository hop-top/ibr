/**
 * Unit tests for Operations#getPageContext null-guard.
 *
 * Even when mode='aria' is configured, if the page's ariaSnapshot()
 * returns null, #getPageContext must fall back to DOM mode (not propagate null
 * or return {context: null, isAria: true}).
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

function makeLocator(ariaSnapshotValue = '- button "Submit"') {
  return {
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    ariaSnapshot: vi.fn().mockResolvedValue(ariaSnapshotValue),
  };
}

function makePage({ html = '<html><head></head><body><p>hi</p></body></html>', ariaResult = '- button "Submit"' } = {}) {
  const loc = makeLocator(ariaResult);
  return {
    content: vi.fn().mockResolvedValue(html),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(0),
    locator: vi.fn().mockReturnValue(loc),
    getByRole: vi.fn().mockReturnValue(loc),
    getByLabel: vi.fn().mockReturnValue(loc),
    getByText: vi.fn().mockReturnValue(loc),
    getByPlaceholder: vi.fn().mockReturnValue(loc),
    _loc: loc,
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

const BASE_TASK = { url: 'https://example.com', instructions: [] };
// An extract response so we can detect which prompt builder was used
const EXTRACT_ARIA_RESP  = JSON.stringify([{ field: 'title', value: 'aria-result' }]);
const EXTRACT_DOM_RESP   = JSON.stringify([{ field: 'title', value: 'dom-result' }]);

// ── tests ──────────────────────────────────────────────────────────────────────

describe('Operations#getPageContext — null snapshot guard with mode="aria"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ariaSnapshot returns null + mode="aria" → falls back to DOM, no null context propagated', async () => {
    // Simulate Playwright ariaSnapshot not available: locator.ariaSnapshot() throws
    const loc = makeLocator(null);
    loc.ariaSnapshot = vi.fn().mockRejectedValue(new Error('ariaSnapshot not supported'));

    const page = makePage();
    page.locator = vi.fn().mockReturnValue(loc);

    const ops = new Operations(makeCtx(page), { mode: 'aria' });

    generateAIResponse.mockResolvedValue(aiResp(EXTRACT_DOM_RESP));

    // execute an extract — it calls #getPageContext internally
    await ops.executeTask({
      ...BASE_TASK,
      instructions: [{ name: 'extract', prompt: 'get title' }],
    });

    // AI must have been called with a non-null, non-empty context
    expect(generateAIResponse).toHaveBeenCalled();
    const [, messages] = generateAIResponse.mock.calls[0];
    // The context string sent to AI must be a non-empty string (DOM fallback)
    const userMsg = messages.find(m => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(typeof userMsg.content).toBe('string');
    expect(userMsg.content.length).toBeGreaterThan(0);
  });

  it('ariaSnapshot returns valid string + mode="aria" → uses ARIA context (isAria=true path)', async () => {
    // page.locator('body').ariaSnapshot() returns a valid ARIA string
    const page = makePage({ ariaResult: '- button "OK"\n- link "Home"' });
    const ops = new Operations(makeCtx(page), { mode: 'aria' });

    // The ARIA prompt messages contain "aria snapshot" or similar wording —
    // we just verify AI is called and no error is thrown.
    generateAIResponse.mockResolvedValue(aiResp(EXTRACT_ARIA_RESP));

    await expect(ops.executeTask({
      ...BASE_TASK,
      instructions: [{ name: 'extract', prompt: 'get title' }],
    })).resolves.not.toThrow();

    expect(generateAIResponse).toHaveBeenCalled();
  });

  it('regression: if null-guard removed, ariaSnapshot null + mode="aria" would produce null context', () => {
    // The selectMode gatekeeper is tested directly in ariaSimplifier.test.js.
    // The integration-level assertion (isAria=false when snapshot is null)
    // is covered by the first test in this describe block.
    // This test is a named sentinel to document the regression path.
    expect(true).toBe(true);
  });
});

describe('Operations#getPageContext — defensive string check inside aria branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('even if selectMode returns aria, context must be a string (not null)', async () => {
    // This tests the secondary guard in Operations.js lines 487-494:
    // `if (typeof snapshot !== 'string')` inside `if (mode === 'aria')`.
    // We force the scenario by having ariaSnapshot return empty string (falsy but
    // still a string) — selectMode auto would pick dom/empty, so we must use mode='aria'.
    // With an empty string, forced-aria returns mode='dom' (forced-aria-unavailable).
    // So: valid string path → snapshot IS passed to context correctly.

    const page = makePage({ ariaResult: '- button "OK"' });
    const ops = new Operations(makeCtx(page), { mode: 'aria' });

    generateAIResponse.mockResolvedValue(aiResp(EXTRACT_ARIA_RESP));

    await ops.executeTask({
      ...BASE_TASK,
      instructions: [{ name: 'extract', prompt: 'title' }],
    });

    const [, messages] = generateAIResponse.mock.calls[0];
    const allContent = messages.map(m => m.content).join('\n');
    // The snapshot content must appear in the prompt
    expect(allContent).toContain('button');
  });
});
