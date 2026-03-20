/**
 * Unit tests for Operations.parseTaskDescription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { Operations } from '../../src/Operations.js';

// ── CacheManager stub ────────────────────────────────────────────────────────

CacheManager.mockImplementation(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  generateKey: vi.fn().mockReturnValue('key'),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makeAIResponse(content, prompt = 10, completion = 5) {
  return { content, usage: { promptTokens: prompt, completionTokens: completion } };
}

const validTask = {
  url: 'https://example.com',
  instructions: [{ name: 'click', prompt: 'the button' }],
};

function makeCtx() {
  return {
    aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
    page: { content: vi.fn().mockResolvedValue('<html></html>') },
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('Operations.parseTaskDescription()', () => {
  let ops;

  beforeEach(() => {
    vi.clearAllMocks();
    ops = new Operations(makeCtx());
  });

  it('throws on empty string', async () => {
    await expect(ops.parseTaskDescription('')).rejects.toThrow(
      'Task description cannot be empty'
    );
  });

  it('throws on whitespace-only string', async () => {
    await expect(ops.parseTaskDescription('   ')).rejects.toThrow(
      'Task description cannot be empty'
    );
  });

  it('throws on non-string (number)', async () => {
    await expect(ops.parseTaskDescription(42)).rejects.toThrow();
  });

  it('throws on non-string (null)', async () => {
    await expect(ops.parseTaskDescription(null)).rejects.toThrow();
  });

  it('returns parsed task when AI returns valid JSON', async () => {
    generateAIResponse.mockResolvedValue(
      makeAIResponse(JSON.stringify(validTask))
    );
    const result = await ops.parseTaskDescription('Do something on example.com');
    expect(result).toMatchObject({ url: 'https://example.com' });
    expect(result.instructions).toHaveLength(1);
  });

  it('parses markdown-wrapped JSON correctly', async () => {
    const md = `\`\`\`json\n${JSON.stringify(validTask)}\n\`\`\``;
    generateAIResponse.mockResolvedValue(makeAIResponse(md));
    const result = await ops.parseTaskDescription('Do something');
    expect(result.url).toBe('https://example.com');
  });

  it('throws "AI model returned empty response" on empty AI content', async () => {
    generateAIResponse.mockResolvedValue(makeAIResponse(''));
    await expect(ops.parseTaskDescription('Do something')).rejects.toThrow(
      'AI model returned an empty response'
    );
  });

  it('throws parse error on invalid JSON from AI', async () => {
    generateAIResponse.mockResolvedValue(makeAIResponse('NOT JSON AT ALL'));
    await expect(ops.parseTaskDescription('Do something')).rejects.toThrow();
  });

  it('throws when parsed JSON missing url field', async () => {
    const noUrl = { instructions: [{ name: 'click', prompt: 'btn' }] };
    generateAIResponse.mockResolvedValue(makeAIResponse(JSON.stringify(noUrl)));
    await expect(ops.parseTaskDescription('Do something')).rejects.toThrow(
      /url/i
    );
  });

  it('throws when instructions array is empty', async () => {
    const emptyInstructions = { url: 'https://example.com', instructions: [] };
    generateAIResponse.mockResolvedValue(
      makeAIResponse(JSON.stringify(emptyInstructions))
    );
    await expect(ops.parseTaskDescription('Do something')).rejects.toThrow();
  });

  it('accumulates token usage after successful parse', async () => {
    generateAIResponse.mockResolvedValue(makeAIResponse(JSON.stringify(validTask), 20, 8));
    await ops.parseTaskDescription('Do something');
    expect(ops.tokenUsage.prompt).toBe(20);
    expect(ops.tokenUsage.completion).toBe(8);
    expect(ops.tokenUsage.total).toBe(28);
  });

  it('accumulates token usage across multiple calls', async () => {
    generateAIResponse.mockResolvedValue(makeAIResponse(JSON.stringify(validTask), 10, 5));
    await ops.parseTaskDescription('Do something');
    await ops.parseTaskDescription('Do something else');
    expect(ops.tokenUsage.prompt).toBe(20);
    expect(ops.tokenUsage.completion).toBe(10);
    expect(ops.tokenUsage.total).toBe(30);
  });
});
