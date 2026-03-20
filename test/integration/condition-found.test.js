/**
 * Integration: condition - element found → success path executes (story 003)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { findElementsResponse, actionResponse } from '../helpers/aiResponses.js';

vi.mock('../../src/ai/provider.js', () => ({
  generateAIResponse: vi.fn(),
}));

import { generateAIResponse } from '../../src/ai/provider.js';

let server;
let ops;
let page;
let cleanup;

beforeAll(async () => {
  server = await startStaticServer();
  ({ operations: ops, page, cleanup } = await buildOperations(
    `${server.baseUrl}/modal-page.html`
  ));
});

afterAll(async () => {
  await cleanup();
  await server.close();
});

afterEach(() => {
  vi.clearAllMocks();
  ops.extracts = [];
  ops.tokenUsage = { prompt: 0, completion: 0, total: 0 };
  ops.executionIndex = 0;
});

describe('condition - found', () => {
  it('executes success_instructions when banner element is found', async () => {
    // find → banner div found (index 5), then action click accept button (index 6)
    generateAIResponse
      .mockResolvedValueOnce(findElementsResponse([5]))
      .mockResolvedValueOnce(actionResponse('click', undefined, [6]));

    await page.goto(`${server.baseUrl}/modal-page.html`);

    const taskDesc = {
      url: `${server.baseUrl}/modal-page.html`,
      instructions: [
        {
          name: 'condition',
          prompt: 'is cookie banner visible',
          success_instructions: [{ name: 'click', prompt: 'click accept button' }],
          failure_instructions: [],
        },
      ],
    };

    await ops.executeTask(taskDesc);

    // success path ran: accept was clicked → banner hidden
    const bannerVisible = await page.evaluate(
      () => document.getElementById('banner').style.display !== 'none'
    );
    expect(bannerVisible).toBe(false);
  });
});
