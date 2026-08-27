/**
 * Unit tests for strict-mode scoping in actionInstruction:
 * when the resolved locator matches multiple elements, the prompt's
 * disambiguating context (email / quoted string / "next to ...") must
 * scope the locator to the nearest ancestor row containing that text.
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

function aiResp(content) {
  return { content, usage: { promptTokens: 5, completionTokens: 3 } };
}

function makeActionLocator(count) {
  return {
    count: vi.fn().mockResolvedValue(count),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Page mock with a strict-mode violation:
 * - getByRole (resolveElement path) → locator matching 2 elements
 * - getByText(scope text) → text locator whose ancestor row contains
 *   exactly one matching element (the scoped locator)
 */
function makeScopingPage() {
  const ambiguous = makeActionLocator(2);
  const scoped = makeActionLocator(1);

  const roleInParent = { first: vi.fn().mockReturnValue(scoped) };
  const parentLocator = { getByRole: vi.fn().mockReturnValue(roleInParent) };
  const textLocator = { locator: vi.fn().mockReturnValue(parentLocator) };

  const bodyLocator = {
    ariaSnapshot: vi.fn().mockResolvedValue('- button "Delete"'),
  };

  return {
    page: {
      content: vi.fn().mockResolvedValue('<html><head></head><body></body></html>'),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(0),
      locator: vi.fn().mockReturnValue(bodyLocator),
      getByRole: vi.fn().mockReturnValue(ambiguous),
      getByLabel: vi.fn().mockReturnValue(ambiguous),
      getByText: vi.fn().mockReturnValue(textLocator),
      getByPlaceholder: vi.fn().mockReturnValue(ambiguous),
    },
    ambiguous,
    scoped,
    textLocator,
  };
}

function makeCtx(page) {
  return {
    aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
    page,
  };
}

const CLICK_DELETE = JSON.stringify({
  elements: [{ role: 'button', name: 'Delete' }],
  type: 'click',
});

describe('Operations strict-mode scoping – actionInstruction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes to prompt context and clicks the scoped element when locator matches multiple', async () => {
    const { page, ambiguous, scoped, textLocator } = makeScopingPage();
    const ops = new Operations(makeCtx(page));
    generateAIResponse.mockResolvedValue(aiResp(CLICK_DELETE));

    await ops.executeTask({
      url: 'https://example.com',
      instructions: [{
        name: 'click',
        prompt: 'click delete next to jad+rami@ideacrafters.com',
      }],
    });

    // Scope text extracted from the prompt (email pattern)
    expect(page.getByText).toHaveBeenCalledWith(
      'jad+rami@ideacrafters.com',
      { exact: false },
    );
    // Nearest-ancestor scoping walked from the text locator
    expect(textLocator.locator).toHaveBeenCalledWith('xpath=ancestor::tr[1]');
    // The SCOPED locator received the click — not the ambiguous one
    expect(scoped.click).toHaveBeenCalledTimes(1);
    expect(ambiguous.click).not.toHaveBeenCalled();
  });

  it('falls back to the original locator when the prompt has no scoping context', async () => {
    const { page, ambiguous, scoped } = makeScopingPage();
    const ops = new Operations(makeCtx(page));
    generateAIResponse.mockResolvedValue(aiResp(CLICK_DELETE));

    await ops.executeTask({
      url: 'https://example.com',
      instructions: [{
        name: 'click',
        // no email / quoted string / "next to ..." → no scope text
        prompt: 'delete it',
      }],
    });

    expect(ambiguous.click).toHaveBeenCalledTimes(1);
    expect(scoped.click).not.toHaveBeenCalled();
  });
});
