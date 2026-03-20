/**
 * Integration: fill action (stories 001, 007)
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
  ops.tokenUsage = { prompt: 0, completion: 0, total: 0 };
  ops.extracts = [];
  ops.executionIndex = 0;
});

describe('fill action', () => {
  it('fills search input with "hello"', async () => {
    // search input is at DomSimplifier index 6 in search-form.html
    generateAIResponse
      .mockResolvedValueOnce(actionResponse('fill', 'hello', [6]));

    await page.goto(`${server.baseUrl}/search-form.html`);

    const taskDesc = {
      url: `${server.baseUrl}/search-form.html`,
      instructions: [{ name: 'fill', prompt: 'fill search input with hello' }],
    };

    await ops.executeTask(taskDesc);

    const inputValue = await page.evaluate(
      () => document.getElementById('search').value
    );
    expect(inputValue).toBe('hello');
  });
});
