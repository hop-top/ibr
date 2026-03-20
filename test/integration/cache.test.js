/**
 * Integration: cache behavior (foundational)
 *
 * Cache is disabled in vitest.config env (CACHE_ENABLED=false).
 * These tests verify the cache flow by enabling it per-test via env override.
 * We directly test CacheManager + Operations caching integration.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildOperations } from '../helpers/buildOperations.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { findElementsResponse } from '../helpers/aiResponses.js';

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

afterEach(async () => {
  vi.clearAllMocks();
  ops.extracts = [];
  ops.tokenUsage = { prompt: 0, completion: 0, total: 0 };
  ops.executionIndex = 0;
  // Reset cache state
  ops.cacheManager.enabled = false;
  ops.cacheManager.initialized = false;
});

describe('cache', () => {
  it('AI is called when cache disabled (baseline)', async () => {
    // Default test env: CACHE_ENABLED=false → AI always called
    generateAIResponse.mockResolvedValueOnce(findElementsResponse([0]));

    await page.goto(`${server.baseUrl}/search-form.html`);

    // Directly invoke findElements via the condition path
    const taskDesc = {
      url: `${server.baseUrl}/search-form.html`,
      instructions: [
        {
          name: 'condition',
          prompt: 'submit button exists',
          success_instructions: [],
          failure_instructions: [],
        },
      ],
    };

    await ops.executeTask(taskDesc);
    expect(generateAIResponse).toHaveBeenCalledTimes(1);
  });

  it('with cache enabled: second same-DOM call returns cached → AI called once', async () => {
    // Enable cache for this test
    process.env.CACHE_ENABLED = 'true';
    ops.cacheManager.enabled = true;
    await ops.cacheManager.init();

    generateAIResponse.mockResolvedValue(findElementsResponse([0]));

    await page.goto(`${server.baseUrl}/search-form.html`);
    ops.url = `${server.baseUrl}/search-form.html`;

    const taskDesc = {
      url: `${server.baseUrl}/search-form.html`,
      instructions: [
        {
          name: 'condition',
          prompt: 'search submit cache test',
          success_instructions: [],
          failure_instructions: [],
        },
      ],
    };

    // First run → AI called
    await ops.executeTask(taskDesc);
    const firstCallCount = generateAIResponse.mock.calls.length;
    expect(firstCallCount).toBeGreaterThanOrEqual(1);

    // Reset executionIndex for second run
    ops.executionIndex = 0;

    // Second run with same DOM → should hit cache → AI NOT called again
    await ops.executeTask(taskDesc);
    const secondCallCount = generateAIResponse.mock.calls.length;

    // Cache hit: no additional AI calls
    expect(secondCallCount).toBe(firstCallCount);

    process.env.CACHE_ENABLED = 'false';
  });

  it('different URL causes cache miss → AI called again', async () => {
    // Enable cache
    process.env.CACHE_ENABLED = 'true';
    ops.cacheManager.enabled = true;
    await ops.cacheManager.init();

    generateAIResponse.mockResolvedValue(findElementsResponse([0]));

    // First run on search-form.html
    const taskDesc1 = {
      url: `${server.baseUrl}/search-form.html`,
      instructions: [
        {
          name: 'condition',
          prompt: 'url change cache test',
          success_instructions: [],
          failure_instructions: [],
        },
      ],
    };

    await ops.executeTask(taskDesc1);
    const firstCallCount = generateAIResponse.mock.calls.length;
    ops.executionIndex = 0;

    // Second run on different URL — different cache key → AI called again
    const taskDesc2 = {
      url: `${server.baseUrl}/product-page.html`,
      instructions: [
        {
          name: 'condition',
          prompt: 'url change cache test',
          success_instructions: [],
          failure_instructions: [],
        },
      ],
    };

    await ops.executeTask(taskDesc2);
    const secondCallCount = generateAIResponse.mock.calls.length;

    // Different URL → cache miss → AI called again
    expect(secondCallCount).toBeGreaterThan(firstCallCount);

    process.env.CACHE_ENABLED = 'false';
  });
});
