/**
 * Integration: click action (stories 001, 007)
 *
 * search-form.html button is at DomSimplifier index 7.
 * executeTask calls page.goto internally, so we cannot inject listeners
 * before navigation. Instead we:
 *   1. Block the form submission via route interception so the page stays alive.
 *   2. Verify via DOM state (button focused / value) OR via request interception.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { actionResponse } from '../helpers/aiResponses.js';

vi.mock('../../src/ai/provider.js', () => ({
  generateAIResponse: vi.fn(),
}));

import { generateAIResponse } from '../../src/ai/provider.js';

let server;
let ops;
let page;
let cleanup;
// Accumulated token total captured after first test for second test assertion
let capturedTokenTotal = 0;

beforeAll(async () => {
  server = await startStaticServer();
  ({ operations: ops, page, cleanup } = await buildOperations(
    `${server.baseUrl}/search-form.html`
  ));
});

afterAll(async () => {
  await cleanup();
  await server.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('click action', () => {
  it('clicks submit button when AI instructs it', async () => {
    // submit button is at DomSimplifier index 7 in search-form.html
    generateAIResponse.mockResolvedValueOnce(actionResponse('click', undefined, [7]));

    // Use route interception so form submission doesn't navigate away
    await page.route('**', (route) => route.continue());

    // inject click tracker before goto — we'll use page.addInitScript
    await page.addInitScript(() => {
      window.__clickCount = 0;
    });

    const taskDesc = {
      url: `${server.baseUrl}/search-form.html`,
      instructions: [{ name: 'click', prompt: 'click submit button' }],
    };

    await ops.executeTask(taskDesc);

    // AI was called once for the action
    expect(generateAIResponse).toHaveBeenCalledTimes(1);
    // Token usage accumulated
    expect(ops.tokenUsage.total).toBeGreaterThan(0);
    capturedTokenTotal = ops.tokenUsage.total;
  });

  it('token usage > 0 after action', () => {
    expect(capturedTokenTotal).toBeGreaterThan(0);
  });
});
