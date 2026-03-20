import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateEnvironmentVariables,
  validateTaskDescription,
  validateAIResponse,
  validateAndParseJSON,
  validateBrowserConfig,
  createErrorContext,
} from '../../../src/utils/validation.js';

// ---------------------------------------------------------------------------
// validateEnvironmentVariables
// ---------------------------------------------------------------------------
describe('validateEnvironmentVariables', () => {
  const SAVED = {};

  beforeEach(() => {
    SAVED.TEST_VAR_A = process.env.TEST_VAR_A;
    SAVED.TEST_VAR_B = process.env.TEST_VAR_B;
    delete process.env.TEST_VAR_A;
    delete process.env.TEST_VAR_B;
  });

  afterEach(() => {
    if (SAVED.TEST_VAR_A !== undefined) process.env.TEST_VAR_A = SAVED.TEST_VAR_A;
    else delete process.env.TEST_VAR_A;
    if (SAVED.TEST_VAR_B !== undefined) process.env.TEST_VAR_B = SAVED.TEST_VAR_B;
    else delete process.env.TEST_VAR_B;
  });

  it('does not throw when all required vars are present', () => {
    process.env.TEST_VAR_A = 'hello';
    expect(() => validateEnvironmentVariables(['TEST_VAR_A'])).not.toThrow();
  });

  it('throws when one var is missing', () => {
    expect(() => validateEnvironmentVariables(['TEST_VAR_A'])).toThrow('TEST_VAR_A');
  });

  it('lists all missing vars when multiple are absent', () => {
    expect(() => validateEnvironmentVariables(['TEST_VAR_A', 'TEST_VAR_B']))
      .toThrow(/TEST_VAR_A.*TEST_VAR_B/);
  });

  it('does not throw for empty required list', () => {
    expect(() => validateEnvironmentVariables([])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateTaskDescription
// ---------------------------------------------------------------------------
describe('validateTaskDescription', () => {
  const valid = {
    url: 'https://example.com',
    instructions: [{ name: 'click', prompt: 'the button' }],
  };

  it('returns true for valid task description', () => {
    expect(validateTaskDescription(valid)).toBe(true);
  });

  it('throws for null input', () => {
    expect(() => validateTaskDescription(null)).toThrow();
  });

  it('throws for non-object input', () => {
    expect(() => validateTaskDescription('string')).toThrow();
  });

  it('throws when url is missing', () => {
    expect(() => validateTaskDescription({ instructions: [{ name: 'click', prompt: 'x' }] }))
      .toThrow(/url/i);
  });

  it('throws when url is not a string', () => {
    expect(() => validateTaskDescription({ url: 123, instructions: [{ name: 'click', prompt: 'x' }] }))
      .toThrow(/url/i);
  });

  it('throws when instructions is not an array', () => {
    expect(() => validateTaskDescription({ url: 'https://x.com', instructions: 'bad' }))
      .toThrow(/instructions/i);
  });

  it('throws when instructions array is empty', () => {
    expect(() => validateTaskDescription({ url: 'https://x.com', instructions: [] }))
      .toThrow(/at least one/i);
  });

  it('throws when instruction is missing name', () => {
    expect(() => validateTaskDescription({
      url: 'https://x.com',
      instructions: [{ prompt: 'do something' }],
    })).toThrow(/name/i);
  });

  it('accepts loop instruction without prompt field', () => {
    expect(() => validateTaskDescription({
      url: 'https://x.com',
      instructions: [{ name: 'loop', instructions: [] }],
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateAIResponse
// ---------------------------------------------------------------------------
describe('validateAIResponse', () => {
  const valid = {
    content: 'some text',
    usage: { promptTokens: 10, completionTokens: 5 },
  };

  it('returns true for valid response', () => {
    expect(validateAIResponse(valid)).toBe(true);
  });

  it('throws when content is not a string', () => {
    expect(() => validateAIResponse({ ...valid, content: 42 })).toThrow(/content/i);
  });

  it('throws when usage is missing', () => {
    expect(() => validateAIResponse({ content: 'ok' })).toThrow(/usage/i);
  });

  it('throws when usage is not an object', () => {
    expect(() => validateAIResponse({ content: 'ok', usage: 'bad' })).toThrow(/usage/i);
  });

  it('throws when promptTokens is not a number', () => {
    expect(() => validateAIResponse({
      content: 'ok',
      usage: { promptTokens: 'x', completionTokens: 5 },
    })).toThrow(/promptTokens/i);
  });

  it('throws when completionTokens is negative', () => {
    expect(() => validateAIResponse({
      content: 'ok',
      usage: { promptTokens: 5, completionTokens: -1 },
    })).toThrow(/completionTokens/i);
  });

  it('throws for null input', () => {
    expect(() => validateAIResponse(null)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// validateAndParseJSON
// ---------------------------------------------------------------------------
describe('validateAndParseJSON', () => {
  it('parses plain JSON object', () => {
    const result = validateAndParseJSON('{"key":"value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses plain JSON array', () => {
    const result = validateAndParseJSON('[1,2,3]');
    expect(result).toEqual([1, 2, 3]);
  });

  it('parses markdown-wrapped JSON', () => {
    const result = validateAndParseJSON('```json\n{"a":1}\n```');
    expect(result).toEqual({ a: 1 });
  });

  it('parses markdown-wrapped JSON without language tag', () => {
    const result = validateAndParseJSON('```\n[1,2]\n```');
    expect(result).toEqual([1, 2]);
  });

  it('throws for unparseable content', () => {
    expect(() => validateAndParseJSON('not json at all !!!')).toThrow();
  });

  it('throws for empty string', () => {
    expect(() => validateAndParseJSON('')).toThrow();
  });

  it('throws for null', () => {
    expect(() => validateAndParseJSON(null)).toThrow();
  });

  it('includes context in error message when provided', () => {
    expect(() => validateAndParseJSON(null, 'myCtx')).toThrow(/myCtx/);
  });
});

// ---------------------------------------------------------------------------
// validateBrowserConfig
// ---------------------------------------------------------------------------
describe('validateBrowserConfig', () => {
  it('returns config unchanged for valid boolean headless', () => {
    const cfg = { headless: true };
    expect(validateBrowserConfig(cfg)).toMatchObject({ headless: true });
  });

  it('returns config unchanged for valid numeric slowMo', () => {
    const cfg = { slowMo: 100 };
    expect(validateBrowserConfig(cfg)).toMatchObject({ slowMo: 100 });
  });

  it('returns config unchanged when all fields valid', () => {
    const cfg = { headless: false, slowMo: 200, timeout: 5000 };
    expect(validateBrowserConfig(cfg)).toEqual(cfg);
  });

  it('throws when headless is not a boolean', () => {
    expect(() => validateBrowserConfig({ headless: 'yes' })).toThrow(/headless/i);
  });

  it('throws when slowMo is not a number', () => {
    expect(() => validateBrowserConfig({ slowMo: '200ms' })).toThrow(/slowMo/i);
  });

  it('throws when timeout is not a number', () => {
    expect(() => validateBrowserConfig({ timeout: '5s' })).toThrow(/timeout/i);
  });

  it('does not throw for empty config', () => {
    expect(() => validateBrowserConfig({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createErrorContext
// ---------------------------------------------------------------------------
describe('createErrorContext', () => {
  it('with no context returns [stage] only', () => {
    expect(createErrorContext('init')).toBe('[init]');
  });

  it('with empty context object returns [stage] only', () => {
    expect(createErrorContext('init', {})).toBe('[init]');
  });

  it('with instructionIndex includes Instruction #N', () => {
    const result = createErrorContext('exec', { instructionIndex: 3 });
    expect(result).toContain('Instruction #3');
  });

  it('with instructionName wraps name in parens', () => {
    const result = createErrorContext('exec', { instructionName: 'click' });
    expect(result).toContain('(click)');
  });

  it('with url includes URL: <value>', () => {
    const result = createErrorContext('exec', { url: 'https://example.com' });
    expect(result).toContain('URL: https://example.com');
  });

  it('with all fields returns correct full format', () => {
    const result = createErrorContext('run', {
      instructionIndex: 2,
      instructionName: 'fill',
      url: 'https://x.com',
    });
    expect(result).toBe('[run] Instruction #2 (fill) URL: https://x.com');
  });
});
