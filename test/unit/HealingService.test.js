import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createDomSignature } from '../../src/cache/CacheUtils.js';

vi.mock('@hop-top/fit', () => ({
  Session: vi.fn().mockImplementation((advisor, executionAdapter, scorer) => ({
    run: vi.fn(async (prompt) => {
      const advice = await advisor.generateAdvice({ prompt });
      const step = await executionAdapter.call(prompt, advice);
      const reward = await scorer.score(step.output, {});
      return { ...step, reward };
    }),
  })),
}));

vi.mock('../../src/ai/provider.js', () => ({
  generateAIResponse: vi.fn(),
}));

vi.mock('../../src/browser/resolvers/InfraManager.js', () => ({
  infraManager: {
    getStrategyForUrl: vi.fn(() => ({ providers: ['local'] })),
  },
}));

vi.mock('../../src/utils/logger.js');

import { Session } from '@hop-top/fit';
import { generateAIResponse } from '../../src/ai/provider.js';
import { HealingService } from '../../src/services/HealingService.js';

function makePage({ url = 'https://example.com' } = {}) {
  return {
    url: vi.fn().mockReturnValue(url),
    content: vi.fn().mockResolvedValue('<html><body><button id="target">Click me</button></body></html>'),
    evaluate: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLocator(isVisible = true) {
  return {
    isVisible: vi.fn().mockResolvedValue(isVisible),
    isEnabled: vi.fn().mockResolvedValue(true),
  };
}

describe('HealingService', () => {
  let testTmpDir;
  let learningsFile;

  beforeEach(async () => {
    vi.clearAllMocks();
    testTmpDir = path.join(os.tmpdir(), `ibr-learnings-test-${Date.now()}`);
    learningsFile = path.join(testTmpDir, 'learnings.json');
    process.env.IBR_LEARNINGS_FILE = learningsFile;
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true });
    delete process.env.IBR_LEARNINGS_FILE;
  });

  it('should hypothesize a fix and return it when successful', async () => {
    const generatedRule = {
      id: 'fix-1',
      urlPattern: 'example\\.com',
      domMutations: { remove: ['.overlay'] },
    };
    generateAIResponse.mockResolvedValue({
      content: JSON.stringify(generatedRule),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const mockOps = {
      ctx: {
        aiProvider: {
          modelInstance: { id: 'fake-model' },
        },
      },
    };

    const service = new HealingService(mockOps);
    await service.init();

    const page = makePage();
    const locator = makeLocator();
    const error = new Error('element is obscured');

    const result = await service.attemptHeal(page, { prompt: 'click button' }, locator, error);

    expect(result).toEqual(generatedRule);
    expect(generateAIResponse).toHaveBeenCalledOnce();
    expect(Session).toHaveBeenCalledOnce();
  });

  it('should record success in LearningsStore', async () => {
    const generatedRule = {
      id: 'fix-1',
      urlPattern: 'example\\.com',
      domMutations: { remove: ['.overlay'] },
    };
    generateAIResponse.mockResolvedValue({
      content: JSON.stringify(generatedRule),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const mockOps = {
      ctx: {
        aiProvider: {
          modelInstance: { id: 'fake-model' },
        },
      },
    };

    const service = new HealingService(mockOps);
    await service.init();

    const page = makePage();
    const locator = makeLocator();
    const error = new Error('obscured');

    await service.attemptHeal(page, { prompt: 'click' }, locator, error);

    const html = await page.content();
    const signature = createDomSignature(html);
    const learnings = service.learningsStore.getSimilarLearnings(signature, 'Error');
    expect(learnings).toEqual([generatedRule]);

    const persisted = JSON.parse(await fs.readFile(learningsFile, 'utf8'));
    expect(persisted[`${signature}:Error`]).toEqual([generatedRule]);
  });
});
