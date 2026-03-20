/**
 * T-0014: Static Instruction Validation
 *
 * Tier 1 tests — no browser, no AI, no timeouts.
 * Validates all JSON fixtures in test/fixtures/ against schema + business rules.
 */

import { describe, it, expect } from 'vitest';
import {
  loadAllFixtures,
  validateFixtureSchema,
  parsePromptString,
  validateInstructionType,
  VALID_CATEGORIES,
  SUPPORTED_INSTRUCTION_NAMES,
} from './fixture-loader.js';

// Fixtures expected to fail validateFixtureSchema (path suffix match)
const EXPECTED_SCHEMA_FAILURES = new Set([
  'edge_cases/empty-instructions.json',
]);

// ── Loader unit tests ─────────────────────────────────────────────────────────

describe('loadAllFixtures()', () => {
  it('loads at least one fixture', async () => {
    const fixtures = await loadAllFixtures();
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it('each entry has fixture, filePath, category, name', async () => {
    const fixtures = await loadAllFixtures();
    for (const entry of fixtures) {
      expect(entry).toHaveProperty('fixture');
      expect(entry).toHaveProperty('filePath');
      expect(entry).toHaveProperty('category');
      expect(entry).toHaveProperty('name');
    }
  });
});

// ── parsePromptString unit tests ──────────────────────────────────────────────

describe('parsePromptString()', () => {
  it('extracts url from url: line', () => {
    const result = parsePromptString('url: https://example.com\ninstructions:\n  - click the button');
    expect(result.url).toBe('https://example.com');
  });

  it('extracts instructions list', () => {
    const result = parsePromptString('url: https://example.com\ninstructions:\n  - click the button');
    expect(result.instructions).toHaveLength(1);
  });

  it('returns empty url when no url: line present', () => {
    const result = parsePromptString('click the button');
    expect(result.url).toBe('');
  });

  it('returns empty instructions when no bullet list', () => {
    const result = parsePromptString('url: https://example.com\ninstructions:');
    expect(result.instructions).toHaveLength(0);
  });

  it('throws TypeError on non-string input', () => {
    expect(() => parsePromptString(null)).toThrow(TypeError);
    expect(() => parsePromptString(42)).toThrow(TypeError);
  });

  it('classifies "click" verbs correctly', () => {
    const result = parsePromptString('url: https://example.com\ninstructions:\n  - click the login button');
    expect(result.instructions[0].name).toBe('click');
  });

  it('classifies "fill" verbs correctly', () => {
    const result = parsePromptString('url: https://example.com\ninstructions:\n  - fill the username field');
    expect(result.instructions[0].name).toBe('fill');
  });

  it('classifies "extract" verbs correctly', () => {
    const result = parsePromptString('url: https://example.com\ninstructions:\n  - extract all product names');
    expect(result.instructions[0].name).toBe('extract');
  });

  it('classifies "loop" verbs correctly', () => {
    const result = parsePromptString('url: https://example.com\ninstructions:\n  - loop while there are more pages');
    expect(result.instructions[0].name).toBe('loop');
  });

  it('classifies "if " prefix as condition', () => {
    const result = parsePromptString('url: https://example.com\ninstructions:\n  - if logged in then extract username');
    expect(result.instructions[0].name).toBe('condition');
  });

  it('handles multiple instructions', () => {
    const prompt = 'url: https://example.com\ninstructions:\n  - fill the email field\n  - click submit\n  - extract the result';
    const result = parsePromptString(prompt);
    expect(result.instructions).toHaveLength(3);
  });

  it('uses SERVER_URL placeholder literally', () => {
    const result = parsePromptString('url: {SERVER_URL}/login\ninstructions:\n  - click the button');
    expect(result.url).toBe('{SERVER_URL}/login');
  });

  it('strips markdown code fences before parsing', () => {
    const prompt = '```\nurl: https://example.com\ninstructions:\n  - click the button\n```';
    const result = parsePromptString(prompt);
    expect(result.url).toBe('https://example.com');
    expect(result.instructions).toHaveLength(1);
  });
});

// ── validateInstructionType unit tests ────────────────────────────────────────

describe('validateInstructionType()', () => {
  it('accepts valid click with prompt', () => {
    expect(() =>
      validateInstructionType('click', { name: 'click', prompt: 'the button' })
    ).not.toThrow();
  });

  it('throws on unknown instruction name', () => {
    expect(() =>
      validateInstructionType('hover', { name: 'hover', prompt: 'something' })
    ).toThrow(/unknown instruction name/);
  });

  it('throws when non-loop/condition instruction missing prompt', () => {
    expect(() =>
      validateInstructionType('click', { name: 'click' })
    ).toThrow(/must have a non-empty, non-whitespace "prompt" field/);
  });

  it('throws when prompt is whitespace-only', () => {
    expect(() =>
      validateInstructionType('click', { name: 'click', prompt: '   ' })
    ).toThrow(/must have a non-empty, non-whitespace "prompt" field/);
  });

  it('allows loop without prompt', () => {
    expect(() =>
      validateInstructionType('loop', { name: 'loop', instructions: [] })
    ).not.toThrow();
  });

  it('allows condition without prompt', () => {
    expect(() =>
      validateInstructionType('condition', { name: 'condition' })
    ).not.toThrow();
  });

  it('accepts all supported instruction names with prompt', () => {
    const names = ['click', 'fill', 'type', 'press', 'scroll', 'extract'];
    for (const name of names) {
      expect(() =>
        validateInstructionType(name, { name, prompt: 'something' })
      ).not.toThrow();
    }
  });
});

// ── validateFixtureSchema unit tests ─────────────────────────────────────────

describe('validateFixtureSchema()', () => {
  const minimal = {
    description: 'test',
    category: 'instruction_types',
    prompt: 'url: https://example.com\ninstructions:\n  - click something',
    expectedParsed: { url: 'https://example.com', instructions: [{ name: 'click', prompt: 'something' }] },
    expectedExtracts: [],
    instructionCoverage: [],
  };

  it('accepts a minimal valid fixture', () => {
    expect(() => validateFixtureSchema(minimal, 'test.json')).not.toThrow();
  });

  it('throws when description is missing', () => {
    const f = { ...minimal, description: '' };
    expect(() => validateFixtureSchema(f, 'test.json')).toThrow(/"description"/);
  });

  it('throws on invalid category', () => {
    const f = { ...minimal, category: 'not_valid' };
    expect(() => validateFixtureSchema(f, 'test.json')).toThrow(/invalid category/);
  });

  it('throws when expectedParsed is missing', () => {
    const { expectedParsed: _, ...f } = minimal;
    expect(() => validateFixtureSchema(f, 'test.json')).toThrow(/"expectedParsed"/);
  });

  it('throws when expectedExtracts is not an array', () => {
    const f = { ...minimal, expectedExtracts: null };
    expect(() => validateFixtureSchema(f, 'test.json')).toThrow(/"expectedExtracts"/);
  });

  it('throws when instructionCoverage is not an array', () => {
    const f = { ...minimal, instructionCoverage: 'click' };
    expect(() => validateFixtureSchema(f, 'test.json')).toThrow(/"instructionCoverage"/);
  });

  it('throws when notes is not a string', () => {
    const f = { ...minimal, notes: 42 };
    expect(() => validateFixtureSchema(f, 'test.json')).toThrow(/"notes"/);
  });

  it('accepts fixture with optional notes and tags', () => {
    const f = { ...minimal, notes: 'some note', tags: ['fast'] };
    expect(() => validateFixtureSchema(f, 'test.json')).not.toThrow();
  });
});

// ── Per-fixture validation via describe.each ──────────────────────────────────

/** Returns true when a filePath matches a known expected-failure key. */
function isExpectedFailure(filePath) {
  return [...EXPECTED_SCHEMA_FAILURES].some((suffix) => filePath.endsWith(suffix));
}

describe('fixture files — static validation', () => {
  // We use a dynamic describe approach since describe.each needs data at definition time.
  // Instead, we run validations in a single test that iterates, giving clear failure context.

  it('all pass-fixtures pass schema validation', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      if (isExpectedFailure(filePath)) continue;
      expect(
        () => validateFixtureSchema(fixture, filePath),
        `Schema validation failed for ${filePath}`
      ).not.toThrow();
    }
  });

  it('expected-failure fixtures throw on schema validation', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      if (!isExpectedFailure(filePath)) continue;
      expect(
        () => validateFixtureSchema(fixture, filePath),
        `Expected ${filePath} to fail schema validation but it passed`
      ).toThrow();
    }
  });

  it('pass-fixtures have non-empty expectedParsed.instructions', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      if (isExpectedFailure(filePath)) continue;
      expect(
        fixture.expectedParsed.instructions.length,
        `${filePath}: expectedParsed.instructions must be non-empty`
      ).toBeGreaterThan(0);
    }
  });

  it('all fixtures have valid instruction names in expectedParsed', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      if (isExpectedFailure(filePath)) continue;
      for (const instr of fixture.expectedParsed.instructions) {
        expect(
          SUPPORTED_INSTRUCTION_NAMES.has(instr.name),
          `${filePath}: unsupported instruction name "${instr.name}"`
        ).toBe(true);
      }
    }
  });

  it('all fixtures satisfy prompt/presence rules per instruction type', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      if (isExpectedFailure(filePath)) continue;
      for (const instr of fixture.expectedParsed.instructions) {
        expect(
          () => validateInstructionType(instr.name, instr, filePath),
          `Instruction type rule failed in ${filePath}`
        ).not.toThrow();
      }
    }
  });

  it('all fixtures have valid category field', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      if (isExpectedFailure(filePath)) continue;
      expect(
        VALID_CATEGORIES.has(fixture.category),
        `${filePath}: invalid category "${fixture.category}"`
      ).toBe(true);
    }
  });

  it('all fixtures prompt parses via parsePromptString without throwing', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      expect(
        () => parsePromptString(fixture.prompt),
        `parsePromptString threw for ${filePath}`
      ).not.toThrow();
    }
  });

  it('instructionCoverage entries are all supported instruction names', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      if (isExpectedFailure(filePath)) continue;
      for (const name of fixture.instructionCoverage) {
        expect(
          SUPPORTED_INSTRUCTION_NAMES.has(name),
          `${filePath}: "instructionCoverage" contains unsupported name "${name}"`
        ).toBe(true);
      }
    }
  });

  it('instructionCoverage is a subset of instruction names in expectedParsed (cross-field)', async () => {
    const fixtures = await loadAllFixtures();
    for (const { fixture, filePath } of fixtures) {
      if (isExpectedFailure(filePath)) continue;
      const namesInParsed = new Set(
        collectAllInstructionNames(fixture.expectedParsed.instructions)
      );
      for (const name of fixture.instructionCoverage) {
        expect(
          namesInParsed.has(name),
          `${filePath}: instructionCoverage entry "${name}" not found in expectedParsed instructions`
        ).toBe(true);
      }
    }
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively collect all instruction names from a nested instructions array.
 * Handles loop.instructions, condition.success_instructions, condition.failure_instructions.
 *
 * @param {Array} instructions
 * @returns {string[]}
 */
function collectAllInstructionNames(instructions) {
  if (!Array.isArray(instructions)) return [];
  const names = [];
  for (const instr of instructions) {
    if (instr.name) names.push(instr.name);
    if (instr.instructions) names.push(...collectAllInstructionNames(instr.instructions));
    if (instr.success_instructions) names.push(...collectAllInstructionNames(instr.success_instructions));
    if (instr.failure_instructions) names.push(...collectAllInstructionNames(instr.failure_instructions));
  }
  return names;
}
