import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateText } from 'ai';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn(() => ({ _provider: 'openai' })),
  createOpenAI: vi.fn(() => vi.fn(() => ({ _provider: 'openai-custom' })))
}));
vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn(() => ({ _provider: 'anthropic' }))
}));
vi.mock('@ai-sdk/google', () => ({
  google: vi.fn(() => ({ _provider: 'google' }))
}));

const loadProvider = async () => {
  const mod = await import('../../../src/ai/provider.js?t=' + Date.now());
  return mod;
};

describe('createAIProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('openai default → provider=openai, model=gpt-4.1-mini', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_MODEL', '');
    vi.stubEnv('OPENAI_BASE_URL', '');
    const { createAIProvider } = await loadProvider();
    const result = createAIProvider();
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4.1-mini');
    expect(result.modelInstance).toBeDefined();
  });

  it('anthropic → provider=anthropic, model=claude-3-5-haiku-20241022', async () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('AI_MODEL', '');
    const { createAIProvider } = await loadProvider();
    const result = createAIProvider();
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-3-5-haiku-20241022');
    expect(result.modelInstance).toBeDefined();
  });

  it('google → provider=google, model=gemini-1.5-flash', async () => {
    vi.stubEnv('AI_PROVIDER', 'google');
    vi.stubEnv('AI_MODEL', '');
    const { createAIProvider } = await loadProvider();
    const result = createAIProvider();
    expect(result.provider).toBe('google');
    expect(result.model).toBe('gemini-1.5-flash');
    expect(result.modelInstance).toBeDefined();
  });

  it('AI_MODEL env override → uses custom model name', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_MODEL', 'gpt-4-turbo');
    vi.stubEnv('OPENAI_BASE_URL', '');
    const { createAIProvider } = await loadProvider();
    const result = createAIProvider();
    expect(result.model).toBe('gpt-4-turbo');
  });
});

describe('generateAIResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const fakeModel = { _provider: 'openai' };
  const messages = [{ role: 'user', content: 'hello' }];

  it('success first try → returns { content, usage }', async () => {
    generateText.mockResolvedValueOnce({
      text: 'Hello world',
      usage: { promptTokens: 10, completionTokens: 5 }
    });
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    const result = await generateAIResponse(fakeModel, messages);
    expect(result.content).toBe('Hello world');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
    expect(result.usage.totalTokens).toBe(15);
  });

  it('missing text → throws', async () => {
    generateText.mockResolvedValueOnce({
      text: '',
      usage: { promptTokens: 5, completionTokens: 0 }
    });
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await expect(generateAIResponse(fakeModel, messages)).rejects.toThrow(
      'AI response missing or invalid text content'
    );
  });

  it('missing text error includes actionable provider hint', async () => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    generateText.mockResolvedValueOnce({
      text: '',
      usage: { promptTokens: 5, completionTokens: 0 }
    });
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await expect(generateAIResponse(fakeModel, messages)).rejects.toThrow(
      'check that AI_PROVIDER and AI_MODEL are set to a supported'
    );
  });

  it('missing usage → throws with api version hint', async () => {
    generateText.mockResolvedValueOnce({
      text: 'hello',
      usage: null,
    });
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await expect(generateAIResponse(fakeModel, messages)).rejects.toThrow(
      'AI response missing usage information'
    );
  });

  it('missing usage error mentions API version mismatch', async () => {
    generateText.mockResolvedValueOnce({
      text: 'hello',
      usage: undefined,
    });
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await expect(generateAIResponse(fakeModel, messages)).rejects.toThrow(
      'API version mismatch or unsupported model'
    );
  });

  it('non-retryable error → throws immediately (no retry)', async () => {
    generateText.mockRejectedValue(new Error('Authentication failed'));
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await expect(generateAIResponse(fakeModel, messages)).rejects.toThrow('Authentication failed');
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it('retryable timeout error → retries up to 3 times then throws', async () => {
    generateText.mockRejectedValue(new Error('timeout occurred'));
    // override sleep to be instant so test doesn't hang
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    // patch global setTimeout used by sleep to resolve immediately
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { fn(); return 0; };
    try {
      await expect(generateAIResponse(fakeModel, messages)).rejects.toThrow('timeout occurred');
      expect(generateText).toHaveBeenCalledTimes(3);
    } finally {
      global.setTimeout = origSetTimeout;
    }
  });

  it('success after 1 retry → returns normalized response', async () => {
    generateText
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValueOnce({
        text: 'Retry success',
        usage: { promptTokens: 20, completionTokens: 8 }
      });
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { fn(); return 0; };
    try {
      const result = await generateAIResponse(fakeModel, messages);
      expect(result.content).toBe('Retry success');
      expect(result.usage.totalTokens).toBe(28);
      expect(generateText).toHaveBeenCalledTimes(2);
    } finally {
      global.setTimeout = origSetTimeout;
    }
  });

  it('usage fields are non-negative integers', async () => {
    generateText.mockResolvedValueOnce({
      text: 'ok',
      usage: { promptTokens: 0, completionTokens: 0 }
    });
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    const result = await generateAIResponse(fakeModel, messages);
    expect(result.usage.promptTokens).toBeGreaterThanOrEqual(0);
    expect(result.usage.completionTokens).toBeGreaterThanOrEqual(0);
    expect(result.usage.totalTokens).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.usage.promptTokens)).toBe(true);
    expect(Number.isInteger(result.usage.completionTokens)).toBe(true);
    expect(Number.isInteger(result.usage.totalTokens)).toBe(true);
  });
});
