/**
 * Integration: extract missing fields → empty result, no exception (stories 002, 011)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';

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

describe('extract missing fields', () => {
  it('does not throw and stores empty array when AI returns []', async () => {
    generateAIResponse.mockResolvedValueOnce({
      content: '[]',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    await page.goto(`${server.baseUrl}/empty-page.html`);

    const taskDesc = {
      url: `${server.baseUrl}/empty-page.html`,
      instructions: [{ name: 'extract', prompt: 'extract product price and name' }],
    };

    await expect(ops.executeTask(taskDesc)).resolves.not.toThrow();
    expect(ops.extracts).toHaveLength(1);
    expect(ops.extracts[0]).toEqual([]);
  });
});
