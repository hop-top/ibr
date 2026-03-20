/**
 * Integration: token usage accumulation (story 013)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { findElementsResponse, extractionResponse } from '../helpers/aiResponses.js';

vi.mock('../../src/ai/provider.js', () => ({
  generateAIResponse: vi.fn(),
}));

import { generateAIResponse } from '../../src/ai/provider.js';

const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function stubWithUsage(content) {
  return { content, usage: { ...USAGE } };
}

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

describe('token usage', () => {
  it('accumulates correct totals across find + extract steps', async () => {
    // Task: condition (1 find call) + extract (1 extract call) = 2 AI calls
    generateAIResponse
      .mockResolvedValueOnce(stubWithUsage(JSON.stringify([{ x: 0 }])))
      .mockResolvedValueOnce(stubWithUsage(JSON.stringify([{ title: 'Widget Pro' }])));

    await page.goto(`${server.baseUrl}/product-page.html`);

    const taskDesc = {
      url: `${server.baseUrl}/product-page.html`,
      instructions: [
        {
          name: 'condition',
          prompt: 'title exists',
          success_instructions: [
            { name: 'extract', prompt: 'extract product title' },
          ],
          failure_instructions: [],
        },
      ],
    };

    await ops.executeTask(taskDesc);

    // 2 AI calls × 10 promptTokens = 20 prompt total
    expect(ops.tokenUsage.prompt).toBe(20);
    expect(ops.tokenUsage.completion).toBe(10);
    expect(ops.tokenUsage.total).toBe(30);
    expect(Number.isInteger(ops.tokenUsage.prompt)).toBe(true);
    expect(Number.isInteger(ops.tokenUsage.completion)).toBe(true);
    expect(Number.isInteger(ops.tokenUsage.total)).toBe(true);
    expect(ops.tokenUsage.prompt).toBeGreaterThanOrEqual(0);
    expect(ops.tokenUsage.completion).toBeGreaterThanOrEqual(0);
    expect(ops.tokenUsage.total).toBeGreaterThanOrEqual(0);
  });
});
