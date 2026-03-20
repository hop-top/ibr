/**
 * Integration: condition - element NOT found → no error, skips action (story 003)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { emptyFindResponse } from '../helpers/aiResponses.js';

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
    `${server.baseUrl}/empty-page.html`
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

describe('condition - not found', () => {
  it('does not throw when condition element absent', async () => {
    generateAIResponse.mockResolvedValueOnce(emptyFindResponse());

    await page.goto(`${server.baseUrl}/empty-page.html`);

    const taskDesc = {
      url: `${server.baseUrl}/empty-page.html`,
      instructions: [
        {
          name: 'condition',
          prompt: 'is popup visible',
          success_instructions: [{ name: 'click', prompt: 'dismiss popup' }],
          failure_instructions: [],
        },
      ],
    };

    await expect(ops.executeTask(taskDesc)).resolves.not.toThrow();
    // action was NOT called (only 1 AI call: the find)
    expect(generateAIResponse).toHaveBeenCalledTimes(1);
  });
});
