/**
 * Integration: loop capped at 100 iterations (stories 004, 012)
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

const MAX_ITERATIONS = 100;

beforeAll(async () => {
  server = await startStaticServer();
  ({ operations: ops, page, cleanup } = await buildOperations(
    `${server.baseUrl}/infinite-page.html`
  ));
}, 60000);

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

describe('loop cap', () => {
  it('stops at 100 iterations and does not reject', async () => {
    // find always returns element found; action returns no elements → skips DOM op
    // This verifies the iteration cap without actual DOM clicks.
    for (let i = 0; i < MAX_ITERATIONS + 5; i++) {
      generateAIResponse
        .mockResolvedValueOnce(findElementsResponse([0]))
        // action returns empty elements → skips click, no DOM side-effect
        .mockResolvedValueOnce({
          content: JSON.stringify({ elements: [], type: 'click' }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        });
    }

    await page.goto(`${server.baseUrl}/infinite-page.html`);

    const taskDesc = {
      url: `${server.baseUrl}/infinite-page.html`,
      instructions: [
        {
          name: 'loop',
          prompt: 'load-more button exists',
          instructions: [{ name: 'click', prompt: 'click load more button' }],
        },
      ],
    };

    await expect(ops.executeTask(taskDesc)).resolves.not.toThrow();

    // find called MAX_ITERATIONS times, action called MAX_ITERATIONS times
    const totalCalls = generateAIResponse.mock.calls.length;
    expect(totalCalls).toBe(MAX_ITERATIONS * 2);
  });
}, 120000);
