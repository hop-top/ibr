/**
 * Unit tests for test/e2e/helpers/structuralMatcher.js
 */

import { describe, it, expect } from 'vitest';
import {
  structuralMatchParsed,
  structuralMatchExtracts,
  numbersMatch,
} from '../../e2e/helpers/structuralMatcher.js';

// ── structuralMatchParsed ─────────────────────────────────────────────────

describe('structuralMatchParsed', () => {
  it('matches identical parsed task descriptions', () => {
    const parsed = {
      url: 'http://localhost/test',
      instructions: [{ name: 'click', prompt: 'the button' }],
    };
    const result = structuralMatchParsed(parsed, parsed);
    expect(result.matches).toBe(true);
    expect(result.match_details.every(d => d.match)).toBe(true);
  });

  it('fails when URL differs', () => {
    const expected = { url: 'http://localhost/a', instructions: [{ name: 'click' }] };
    const actual = { url: 'http://localhost/b', instructions: [{ name: 'click' }] };
    const result = structuralMatchParsed(expected, actual);
    expect(result.matches).toBe(false);
    const urlDetail = result.match_details.find(d => d.path === 'url');
    expect(urlDetail.match).toBe(false);
    expect(urlDetail.actual).toBe('http://localhost/b');
  });

  it('fails when instruction count differs', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [{ name: 'click' }, { name: 'fill' }],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [{ name: 'click' }],
    };
    const result = structuralMatchParsed(expected, actual);
    expect(result.matches).toBe(false);
    const lenDetail = result.match_details.find(d => d.path === 'instructions.length');
    expect(lenDetail.match).toBe(false);
  });

  it('fails when instruction name differs', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [{ name: 'click' }],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [{ name: 'fill' }],
    };
    const result = structuralMatchParsed(expected, actual);
    expect(result.matches).toBe(false);
    const nameDetail = result.match_details.find(d => d.path === 'instructions[0].name');
    expect(nameDetail.match).toBe(false);
    expect(nameDetail.expected).toBe('click');
    expect(nameDetail.actual).toBe('fill');
  });

  it('fails when actual is null/non-object', () => {
    const expected = { url: 'http://localhost/', instructions: [] };
    const result = structuralMatchParsed(expected, null);
    expect(result.matches).toBe(false);
  });

  it('records <missing> for out-of-bounds instruction entries', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [{ name: 'click' }, { name: 'fill' }],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [{ name: 'click' }],
    };
    const result = structuralMatchParsed(expected, actual);
    const missing = result.match_details.find(d => d.path === 'instructions[1].name');
    expect(missing.actual).toBe('<missing>');
  });

  it('handles actual.url being undefined (returns null)', () => {
    const expected = { url: '', instructions: [] };
    const actual = { instructions: [] };
    const result = structuralMatchParsed(expected, actual);
    const urlDetail = result.match_details.find(d => d.path === 'url');
    expect(urlDetail.actual).toBe(null);
  });
});

// ── structuralMatchExtracts ───────────────────────────────────────────────

describe('structuralMatchExtracts', () => {
  it('exact match when both arrays are empty', () => {
    const result = structuralMatchExtracts([], []);
    expect(result.matches).toBe(true);
    expect(result.match_type).toBe('exact');
  });

  it('fails when expected length > actual length', () => {
    const result = structuralMatchExtracts([{ name: 'Alice' }], []);
    expect(result.matches).toBe(false);
  });

  it('fails when actual length > expected length', () => {
    const result = structuralMatchExtracts([], [{ name: 'Alice' }]);
    expect(result.matches).toBe(false);
  });

  it('matches when key sets and types agree', () => {
    const expected = [{ name: 'Alice', age: 30 }];
    const actual = [{ name: 'Bob', age: 25 }];
    const result = structuralMatchExtracts(expected, actual);
    expect(result.matches).toBe(true);
    expect(result.match_type).toBe('structural');
    expect(result.structural_notes).toMatch(/needs_llm_eval/);
  });

  it('fails when key sets differ', () => {
    const expected = [{ name: 'Alice' }];
    const actual = [{ username: 'Alice' }];
    const result = structuralMatchExtracts(expected, actual);
    expect(result.matches).toBe(false);
  });

  it('fails when value types differ', () => {
    const expected = [{ count: 5 }];
    const actual = [{ count: 'five' }];
    const result = structuralMatchExtracts(expected, actual);
    expect(result.matches).toBe(false);
    const typeDetail = result.match_details.find(d => d.path === 'extracts[0].count.type');
    expect(typeDetail.expected).toBe('number');
    expect(typeDetail.actual).toBe('string');
    expect(typeDetail.match).toBe(false);
  });
});

// ── numbersMatch ──────────────────────────────────────────────────────────

describe('numbersMatch', () => {
  it('matches identical numbers', () => {
    expect(numbersMatch(100, 100)).toBe(true);
  });

  it('matches within 10% tolerance', () => {
    expect(numbersMatch(100, 105)).toBe(true);
    expect(numbersMatch(100, 95)).toBe(true);
  });

  it('fails when outside 10% tolerance', () => {
    expect(numbersMatch(100, 115)).toBe(false);
    expect(numbersMatch(100, 85)).toBe(false);
  });

  it('handles zero expected', () => {
    expect(numbersMatch(0, 0)).toBe(true);
    expect(numbersMatch(0, 1)).toBe(false);
  });
});
