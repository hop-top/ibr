/**
 * Unit tests for test/e2e/helpers/structuralMatcher.js (T-0015).
 */

import { describe, it, expect } from 'vitest';
import { matchParsed, matchExtracts } from '../../e2e/helpers/structuralMatcher.js';

// ── matchParsed ───────────────────────────────────────────────────────────────

describe('matchParsed()', () => {
  it('matches identical simple parsed output', () => {
    const expected = {
      url: 'http://localhost/login',
      instructions: [{ name: 'click', prompt: 'the login button' }],
    };
    const actual = {
      url: 'http://localhost/login',
      instructions: [{ name: 'click', prompt: 'the login button' }],
    };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(true);
    expect(result.match_details.every(d => d.match)).toBe(true);
  });

  it('fails on URL mismatch', () => {
    const expected = { url: 'http://localhost/login', instructions: [] };
    const actual = { url: 'http://localhost/other', instructions: [] };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(false);
    const urlDetail = result.match_details.find(d => d.path === 'url');
    expect(urlDetail?.match).toBe(false);
  });

  it('fails on instruction count mismatch', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [{ name: 'click', prompt: 'a' }, { name: 'fill', prompt: 'b' }],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [{ name: 'click', prompt: 'a' }],
    };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(false);
  });

  it('fails on instruction name mismatch', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [{ name: 'click', prompt: 'a' }],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [{ name: 'fill', prompt: 'a' }],
    };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(false);
    const nameDetail = result.match_details.find(d => d.path === 'instructions[0].name');
    expect(nameDetail?.match).toBe(false);
  });

  it('passes when actual prompt is non-empty (structural only)', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [{ name: 'fill', prompt: 'the username field with admin' }],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [{ name: 'fill', prompt: 'username field: admin' }], // different text, still non-empty
    };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(true);
  });

  it('fails when actual prompt is empty', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [{ name: 'click', prompt: 'the button' }],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [{ name: 'click', prompt: '' }],
    };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(false);
  });

  it('returns false with null actual', () => {
    const expected = { url: 'http://localhost/', instructions: [] };
    const result = matchParsed(expected, null);
    expect(result.matches).toBe(false);
  });

  it('handles loop instruction with nested instructions', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [
        {
          name: 'loop',
          instructions: [
            { name: 'extract', prompt: 'product names' },
            { name: 'click', prompt: 'next page' },
          ],
        },
      ],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [
        {
          name: 'loop',
          instructions: [
            { name: 'extract', prompt: 'all product names on the page' },
            { name: 'click', prompt: 'next page button' },
          ],
        },
      ],
    };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(true);
  });

  it('fails loop with wrong nested name', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [
        {
          name: 'loop',
          instructions: [{ name: 'extract', prompt: 'items' }],
        },
      ],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [
        {
          name: 'loop',
          instructions: [{ name: 'click', prompt: 'items' }],
        },
      ],
    };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(false);
  });

  it('handles condition instruction with branches', () => {
    const expected = {
      url: 'http://localhost/',
      instructions: [
        {
          name: 'condition',
          success_instructions: [{ name: 'extract', prompt: 'username' }],
          failure_instructions: [{ name: 'click', prompt: 'login link' }],
        },
      ],
    };
    const actual = {
      url: 'http://localhost/',
      instructions: [
        {
          name: 'condition',
          success_instructions: [{ name: 'extract', prompt: 'the current username' }],
          failure_instructions: [{ name: 'click', prompt: 'the login link' }],
        },
      ],
    };
    const result = matchParsed(expected, actual);
    expect(result.matches).toBe(true);
  });
});

// ── matchExtracts ─────────────────────────────────────────────────────────────

describe('matchExtracts()', () => {
  it('returns matches:true for empty expected (no assertion)', () => {
    const result = matchExtracts([], []);
    expect(result.matches).toBe(true);
    expect(result.match_type).toBe('structural');
  });

  it('returns matches:true for empty expected with non-empty actual', () => {
    const result = matchExtracts([], ['foo', 'bar']);
    expect(result.matches).toBe(true);
  });

  it('fails on length mismatch when expected is non-empty', () => {
    const result = matchExtracts([{ title: 'Foo' }], []);
    expect(result.matches).toBe(false);
    const lenDetail = result.match_details.find(d => d.path === 'extracts.length');
    expect(lenDetail?.match).toBe(false);
  });

  it('flags scalar string values as needs_llm_eval (structural pass)', () => {
    const result = matchExtracts(['expected title'], ['actual title']);
    expect(result.matches).toBe(true);
    const detail = result.match_details.find(d => d.note === 'needs_llm_eval');
    expect(detail).toBeDefined();
  });

  it('passes on matching object shape', () => {
    const expected = [{ title: 'foo', price: 10 }];
    const actual = [{ title: 'bar', price: 9 }]; // different values, same keys
    const result = matchExtracts(expected, actual);
    expect(result.matches).toBe(true);
  });

  it('fails on object key mismatch', () => {
    const expected = [{ title: 'foo', price: 10 }];
    const actual = [{ name: 'bar', cost: 9 }]; // different keys
    const result = matchExtracts(expected, actual);
    expect(result.matches).toBe(false);
  });

  it('passes number within 10% tolerance', () => {
    const result = matchExtracts([{ price: 100 }], [{ price: 105 }]);
    expect(result.matches).toBe(true);
  });

  it('fails number outside 10% tolerance', () => {
    const result = matchExtracts([{ price: 100 }], [{ price: 120 }]);
    expect(result.matches).toBe(false);
  });

  it('fails on type mismatch (string vs number)', () => {
    const result = matchExtracts(['text'], [42]);
    expect(result.matches).toBe(false);
  });
});
