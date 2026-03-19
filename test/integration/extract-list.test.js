/**
 * Integration: extract list (stories 002, 008)
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
    `${server.baseUrl}/product-list.html`
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

describe('extract list', () => {
  it('extracts array of 3 products', async () => {
    const items = [
      { name: 'Widget Alpha', price: '$4.99' },
      { name: 'Widget Beta', price: '$7.49' },
      { name: 'Widget Gamma', price: '$12.00' },
    ];
    generateAIResponse.mockResolvedValueOnce(extractionResponse(items));

    await page.goto(`${server.baseUrl}/product-list.html`);

    const taskDesc = {
      url: `${server.baseUrl}/product-list.html`,
      instructions: [{ name: 'extract', prompt: 'extract all product names and prices' }],
    };

    await ops.executeTask(taskDesc);

    expect(ops.extracts).toHaveLength(1);
    const extracted = ops.extracts[0];
    expect(Array.isArray(extracted)).toBe(true);
    expect(extracted).toHaveLength(3);
  });
});
