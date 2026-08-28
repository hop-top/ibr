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

// ── Unit 2 (vision-mode): image message part + VISUAL_AI_MODEL + capability gate ──
// generateAIResponse gains the ability to include an image content part when the
// caller passes {image: Buffer, mime} in options. This is additive: every prior
// test above (no {image}) must stay green — text-only behavior is unchanged.
describe('generateAIResponse — visual (image) path', () => {
  const fakeModel = { _provider: 'openai' };
  const messages = [{ role: 'user', content: 'hello' }];
  const textPrompt = [{ role: 'user', content: [{ type: 'text', text: 'find the login button' }] }];
  const fakeImage = Buffer.from('fake-png-bytes');

  beforeEach(() => {
    vi.clearAllMocks();
    generateText.mockResolvedValue({
      text: '[{"mark":1}]',
      usage: { promptTokens: 10, completionTokens: 5 }
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('no {image} passed → messages sent to the sdk are unchanged (text-only)', async () => {
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await generateAIResponse(fakeModel, messages);
    const callArgs = generateText.mock.calls[0][0];
    expect(callArgs.messages).toEqual(messages);
  });

  it('{image, mime} passed → an image content part is included in the message sent to the sdk', async () => {
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await generateAIResponse(fakeModel, textPrompt, { image: fakeImage, mime: 'image/png' });
    const callArgs = generateText.mock.calls[0][0];
    const lastMessage = callArgs.messages[callArgs.messages.length - 1];
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const imagePart = lastMessage.content.find((part) => part.type === 'image');
    expect(imagePart).toBeDefined();
    expect(imagePart.image).toBe(fakeImage);
    expect(imagePart.mediaType).toBe('image/png');
    // Original text part(s) are preserved alongside the image part.
    const textPart = lastMessage.content.find((part) => part.type === 'text');
    expect(textPart).toBeDefined();
    expect(textPart.text).toBe('find the login button');
  });

  it('{image} passed but options.image is falsy/absent → no image part added (unchanged)', async () => {
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await generateAIResponse(fakeModel, textPrompt, { temperature: 0.2 });
    const callArgs = generateText.mock.calls[0][0];
    const lastMessage = callArgs.messages[callArgs.messages.length - 1];
    // Message content is passed through as-is — no image part synthesized.
    const hasImagePart = Array.isArray(lastMessage.content) &&
      lastMessage.content.some((part) => part.type === 'image');
    expect(hasImagePart).toBe(false);
  });

  it('VISUAL_AI_MODEL is consulted only when an image is present — no image → normal model used', async () => {
    vi.stubEnv('VISUAL_AI_MODEL', 'gpt-4o');
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await generateAIResponse(fakeModel, messages);
    const callArgs = generateText.mock.calls[0][0];
    // No image → the caller-supplied modelInstance is used verbatim, VISUAL_AI_MODEL ignored.
    expect(callArgs.model).toBe(fakeModel);
  });

  it('VISUAL_AI_MODEL set + image present + a resolvable provider → builds and uses the override model', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('VISUAL_AI_MODEL', 'gpt-4o');
    const { openai } = await import('@ai-sdk/openai');
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await generateAIResponse(fakeModel, textPrompt, { image: fakeImage, mime: 'image/png', provider: 'openai' });
    expect(openai).toHaveBeenCalledWith('gpt-4o');
    const callArgs = generateText.mock.calls[0][0];
    expect(callArgs.model).not.toBe(fakeModel);
  });

  it('no VISUAL_AI_MODEL + image present → falls back to the run\'s configured (passed-in) model', async () => {
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await generateAIResponse(fakeModel, textPrompt, { image: fakeImage, mime: 'image/png', provider: 'openai' });
    const callArgs = generateText.mock.calls[0][0];
    expect(callArgs.model).toBe(fakeModel);
  });

  it('known non-vision VISUAL_AI_MODEL + image present → throws CliError CONFIG_ERROR before calling the sdk', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('VISUAL_AI_MODEL', 'gpt-3.5-turbo');
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    const { CliError } = await import('../../../src/utils/cliErrors.js');
    await expect(
      generateAIResponse(fakeModel, textPrompt, { image: fakeImage, mime: 'image/png', provider: 'openai' })
    ).rejects.toThrow(CliError);
    await expect(
      generateAIResponse(fakeModel, textPrompt, { image: fakeImage, mime: 'image/png', provider: 'openai' })
    ).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    expect(generateText).not.toHaveBeenCalled();
  });

  it('known non-vision model gate does NOT trigger for text-only calls (no image)', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('VISUAL_AI_MODEL', 'gpt-3.5-turbo');
    const { generateAIResponse } = await import('../../../src/ai/provider.js');
    await expect(generateAIResponse(fakeModel, messages)).resolves.toBeDefined();
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
