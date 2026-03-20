/**
 * Integration: extract scalar (stories 002, 008, 011)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { extractionResponse } from '../helpers/aiResponses.js';

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
    `${server.baseUrl}/product-page.html`
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

describe('extract scalar', () => {
  it('extracts product title and price', async () => {
    generateAIResponse.mockResolvedValueOnce(
      extractionResponse([{ title: 'Widget Pro', price: '$9.99' }])
    );

    await page.goto(`${server.baseUrl}/product-page.html`);

    const taskDesc = {
      url: `${server.baseUrl}/product-page.html`,
      instructions: [{ name: 'extract', prompt: 'extract product title and price' }],
    };

    await ops.executeTask(taskDesc);

    expect(ops.extracts).toHaveLength(1);
    // extracts[0] is the wrapped array from #extractInstruction
    const extracted = ops.extracts[0];
    expect(Array.isArray(extracted)).toBe(true);
    expect(extracted[0]).toMatchObject({ title: 'Widget Pro', price: '$9.99' });
  });
});
