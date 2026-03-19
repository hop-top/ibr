/**
 * Integration: loop exits after condition becomes false (stories 004, 012)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { findElementsResponse, emptyFindResponse, actionResponse } from '../helpers/aiResponses.js';

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
    `${server.baseUrl}/paginated-list.html`
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

describe('loop exits', () => {
  it('runs loop body exactly 3 times then exits', async () => {
    // find returns element found for first 3 iterations, then empty → exits
    generateAIResponse
      // iteration 1: find → found, then action
      .mockResolvedValueOnce(findElementsResponse([0]))
      .mockResolvedValueOnce(actionResponse('click', undefined, [0]))
      // iteration 2: find → found, then action
      .mockResolvedValueOnce(findElementsResponse([0]))
      .mockResolvedValueOnce(actionResponse('click', undefined, [0]))
      // iteration 3: find → found, then action
      .mockResolvedValueOnce(findElementsResponse([0]))
      .mockResolvedValueOnce(actionResponse('click', undefined, [0]))
      // iteration 4: find → empty → loop breaks
      .mockResolvedValueOnce(emptyFindResponse());

    await page.goto(`${server.baseUrl}/paginated-list.html`);

    const taskDesc = {
      url: `${server.baseUrl}/paginated-list.html`,
      instructions: [
        {
          name: 'loop',
          prompt: 'next page button exists',
          instructions: [{ name: 'click', prompt: 'click next page button' }],
        },
      ],
    };

    await ops.executeTask(taskDesc);

    // find called 4 times (3 true + 1 false), action called 3 times
    const findCalls = generateAIResponse.mock.calls.length;
    // 4 finds + 3 actions = 7 total
    expect(findCalls).toBe(7);
  });
});
