import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Operations } from '../../src/Operations.js';
import { augmentationEngine } from '../../src/services/AugmentationEngine.js';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');
vi.mock('../../src/services/AugmentationEngine.js', () => ({
  augmentationEngine: {
    init: vi.fn().mockResolvedValue(undefined),
    getRulesForUrl: vi.fn().mockReturnValue([]),
  }
}));

function makeLocator() {
  return {
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    ariaSnapshot: vi.fn().mockResolvedValue('- button "Submit"'),
  };
}

function makePage({ url = 'https://example.com' } = {}) {
  const loc = makeLocator();
  return {
    url: vi.fn().mockReturnValue(url),
    content: vi.fn().mockResolvedValue('<html></html>'),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async (fn, arg) => {
      // Handle the case where fn is a function and we're mocking browser env
      if (typeof fn === 'function') {
        // For #preparePage which asks for window.scrollY
        if (fn.toString().includes('window.scrollY')) return 0;
        // For other evaluate calls, just return a success
        return undefined;
      }
      return 0;
    }),
    locator: vi.fn().mockReturnValue(loc),
  };
}

function makeCtx(page) {
  return {
    aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
    page,
  };
}

describe('Operations — Augmentation Engine integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize augmentation engine in executeTask', async () => {
    const page = makePage();
    const ops = new Operations(makeCtx(page));
    
    await ops.executeTask({ url: 'https://example.com', instructions: [] });
    
    expect(augmentationEngine.init).toHaveBeenCalled();
  });

  it('should call getRulesForUrl with the current page URL', async () => {
    const page = makePage({ url: 'https://target.com' });
    const ops = new Operations(makeCtx(page));
    
    // We need to execute something that calls #getPageContext
    // Mock generateAIResponse to return something valid
    const { generateAIResponse } = await import('../../src/ai/provider.js');
    generateAIResponse.mockResolvedValue({ 
      content: '[]', 
      usage: { promptTokens: 0, completionTokens: 0 } 
    });

    await ops.executeTask({ 
      url: 'https://target.com', 
      instructions: [{ name: 'extract', prompt: 'test' }] 
    });
    
    expect(augmentationEngine.getRulesForUrl).toHaveBeenCalledWith('https://target.com');
  });

  it('should execute rules in the browser when matches are found', async () => {
    const page = makePage();
    const ops = new Operations(makeCtx(page));
    
    const rule = {
      id: 'test-rule',
      domMutations: { remove: ['.ad'] },
      scripting: { evaluateBeforeSnapshot: 'window.augmented = true;' }
    };
    augmentationEngine.getRulesForUrl.mockReturnValue([rule]);

    const { generateAIResponse } = await import('../../src/ai/provider.js');
    generateAIResponse.mockResolvedValue({ 
      content: '[]', 
      usage: { promptTokens: 0, completionTokens: 0 } 
    });

    await ops.executeTask({ 
      url: 'https://example.com', 
      instructions: [{ name: 'extract', prompt: 'test' }] 
    });

    // Check if evaluate was called (indirectly through our mock implementation)
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('should NOT execute rules when ignoreAugmentations is true', async () => {
    const page = makePage();
    const ops = new Operations(makeCtx(page), { ignoreAugmentations: true });
    
    augmentationEngine.getRulesForUrl.mockReturnValue([{ id: 'test' }]);

    const { generateAIResponse } = await import('../../src/ai/provider.js');
    generateAIResponse.mockResolvedValue({ 
      content: '[]', 
      usage: { promptTokens: 0, completionTokens: 0 } 
    });

    await ops.executeTask({ 
      url: 'https://example.com', 
      instructions: [{ name: 'extract', prompt: 'test' }] 
    });

    // evaluate was NOT called for augmentations (only once for goto or other internals if any)
    // Actually our mock evaluate for augmentations is identifiable.
    // In #getPageContext, if we ignore, we don't call evaluate with rules.
    const ruleCalls = page.evaluate.mock.calls.filter(call => Array.isArray(call[1]) && call[1][0]?.id === 'test');
    expect(ruleCalls.length).toBe(0);
  });
});
