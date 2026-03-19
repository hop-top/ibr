/**
 * Integration: error propagation (story 009)
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
    `${server.baseUrl}/search-form.html`
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

describe('error propagation', () => {
  it('rejects when AI stub throws non-retryable error on action step', async () => {
    const fatalError = new Error('Invalid API key - fatal');
    generateAIResponse.mockRejectedValueOnce(fatalError);

    await page.goto(`${server.baseUrl}/search-form.html`);

    const taskDesc = {
      url: `${server.baseUrl}/search-form.html`,
      instructions: [{ name: 'click', prompt: 'submit button' }],
    };

    await expect(ops.executeTask(taskDesc)).rejects.toThrow('Invalid API key - fatal');
  });

  it('does NOT reject when condition element is absent (find returns empty)', async () => {
    generateAIResponse.mockResolvedValueOnce(emptyFindResponse());

    await page.goto(`${server.baseUrl}/empty-page.html`);

    const taskDesc = {
      url: `${server.baseUrl}/empty-page.html`,
      instructions: [
        {
          name: 'condition',
          prompt: 'some element exists',
          success_instructions: [{ name: 'click', prompt: 'click it' }],
          failure_instructions: [],
        },
      ],
    };

    await expect(ops.executeTask(taskDesc)).resolves.not.toThrow();
  });
});
