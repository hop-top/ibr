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

  describe('visualContext (optional 5th arg)', () => {
    function makeMockOps() {
      return {
        ctx: {
          aiProvider: {
            modelInstance: { id: 'fake-model' },
            provider: 'anthropic',
            model: 'claude-3-5-haiku-20241022',
          },
        },
      };
    }

    const generatedRule = {
      id: 'fix-1',
      urlPattern: 'example\\.com',
      domMutations: { remove: ['.overlay'] },
    };

    beforeEach(() => {
      generateAIResponse.mockResolvedValue({
        content: JSON.stringify(generatedRule),
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    });

    it('includes the image in the generateAIResponse options when visualContext.image is passed', async () => {
      const service = new HealingService(makeMockOps());
      await service.init();

      const page = makePage();
      const locator = makeLocator();
      const error = new Error('element is obscured');
      const imageBuf = Buffer.from('fake-png-bytes');
      const markMap = new Map([['@e7', { bbox: { x: 0, y: 0, width: 10, height: 10 } }]]);

      const result = await service.attemptHeal(page, { prompt: 'click button' }, locator, error, {
        image: imageBuf,
        mime: 'image/png',
        markMap,
      });

      expect(result).toEqual(generatedRule);
      expect(generateAIResponse).toHaveBeenCalledOnce();
      const [, , options] = generateAIResponse.mock.calls[0];
      expect(options.image).toBe(imageBuf);
      expect(options.mime).toBe('image/png');
    });

    it('passes provider and model from ctx.aiProvider when visualContext.image is present, so VISUAL_AI_MODEL resolves to the right client', async () => {
      const service = new HealingService(makeMockOps());
      await service.init();

      const page = makePage();
      const locator = makeLocator();
      const error = new Error('element is obscured');
      const imageBuf = Buffer.from('fake-png-bytes');

      await service.attemptHeal(page, { prompt: 'click button' }, locator, error, {
        image: imageBuf,
        mime: 'image/png',
      });

      const [, , options] = generateAIResponse.mock.calls[0];
      expect(options.provider).toBe('anthropic');
      expect(options.model).toBe('claude-3-5-haiku-20241022');
    });

    it('mentions the visual marks in the heal prompt when an image is passed', async () => {
      const service = new HealingService(makeMockOps());
      await service.init();

      const page = makePage();
      const locator = makeLocator();
      const error = new Error('element is obscured');
      const imageBuf = Buffer.from('fake-png-bytes');
      const markMap = new Map([['@e7', { bbox: { x: 0, y: 0, width: 10, height: 10 } }]]);

      await service.attemptHeal(page, { prompt: 'click button' }, locator, error, {
        image: imageBuf,
        mime: 'image/png',
        markMap,
      });

      const [, messages] = generateAIResponse.mock.calls[0];
      const prompt = messages[0].content;
      expect(prompt).toMatch(/@e7/);
      expect(prompt).toMatch(/screenshot|visual|image/i);
    });

    it('behaves exactly as before (no image option) when visualContext is omitted — 4-arg call', async () => {
      const service = new HealingService(makeMockOps());
      await service.init();

      const page = makePage();
      const locator = makeLocator();
      const error = new Error('element is obscured');

      const result = await service.attemptHeal(page, { prompt: 'click button' }, locator, error);

      expect(result).toEqual(generatedRule);
      expect(generateAIResponse).toHaveBeenCalledOnce();
      const [, messages, options] = generateAIResponse.mock.calls[0];
      expect(options.image).toBeUndefined();
      expect(options.mime).toBeUndefined();
      expect(messages[0].content).not.toMatch(/screenshot|visual mark/i);
    });

    it('behaves exactly as before when visualContext is null', async () => {
      const service = new HealingService(makeMockOps());
      await service.init();

      const page = makePage();
      const locator = makeLocator();
      const error = new Error('element is obscured');

      const result = await service.attemptHeal(page, { prompt: 'click button' }, locator, error, null);

      expect(result).toEqual(generatedRule);
      const [, , options] = generateAIResponse.mock.calls[0];
      expect(options.image).toBeUndefined();
    });

    it('behaves exactly as before when visualContext has no image (markMap-only)', async () => {
      const service = new HealingService(makeMockOps());
      await service.init();

      const page = makePage();
      const locator = makeLocator();
      const error = new Error('element is obscured');

      const result = await service.attemptHeal(page, { prompt: 'click button' }, locator, error, { markMap: new Map() });

      expect(result).toEqual(generatedRule);
      const [, , options] = generateAIResponse.mock.calls[0];
      expect(options.image).toBeUndefined();
    });

    it('emits the same persisted fix shape (augmentations rule) whether or not an image was used', async () => {
      const withImageService = new HealingService(makeMockOps());
      await withImageService.init();
      const withoutImageService = new HealingService(makeMockOps());
      await withoutImageService.init();

      const page = makePage();
      const locator = makeLocator();
      const error = new Error('element is obscured');

      const withImageResult = await withImageService.attemptHeal(page, { prompt: 'click button' }, locator, error, {
        image: Buffer.from('x'),
        mime: 'image/png',
      });
      const withoutImageResult = await withoutImageService.attemptHeal(page, { prompt: 'click button' }, locator, error);

      expect(withImageResult).toEqual(withoutImageResult);
      expect(withImageResult).toEqual(generatedRule);
    });
  });
});
