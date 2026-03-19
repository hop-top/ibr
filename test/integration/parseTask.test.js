/**
 * Integration: parseTaskDescription (story 010)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { taskDescriptionResponse } from '../helpers/aiResponses.js';

vi.mock('../../src/ai/provider.js', () => ({
  generateAIResponse: vi.fn(),
}));

import { generateAIResponse } from '../../src/ai/provider.js';

let server;
let ops;
let cleanup;

beforeAll(async () => {
  server = await startStaticServer();
  ({ operations: ops, cleanup } = await buildOperations(`${server.baseUrl}/empty-page.html`));
});

afterAll(async () => {
  await cleanup();
  await server.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('parseTaskDescription', () => {
  it('returns structured task for valid AI stub', async () => {
    const stub = taskDescriptionResponse(
      `${server.baseUrl}/search-form.html`,
      [{ name: 'click', prompt: 'submit button' }]
    );
    generateAIResponse.mockResolvedValueOnce(stub);

    const result = await ops.parseTaskDescription('Search and click submit on search page');

    expect(result).toMatchObject({
      url: `${server.baseUrl}/search-form.html`,
      instructions: expect.arrayContaining([
        expect.objectContaining({ name: 'click' }),
      ]),
    });
  });

  it('throws when prompt is empty', async () => {
    await expect(ops.parseTaskDescription('')).rejects.toThrow();
  });

  it('throws with message when AI returns garbage', async () => {
    generateAIResponse.mockResolvedValueOnce({
      content: 'NOT_JSON_AT_ALL',
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
    });

    await expect(
      ops.parseTaskDescription('do something')
    ).rejects.toThrow();
  });
});
