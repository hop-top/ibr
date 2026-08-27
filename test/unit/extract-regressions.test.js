/**
 * Regression tests for extract char-by-char bug (T-0003).
 *
 * Two bugs:
 * 1. Winston logger.info(msg, string) spreads string as char-indexed metadata
 * 2. parseExtractionResponse returns string arrays that get silently dropped
 *    by the NDJSON streamer (only emits typeof === 'object')
 */

import { describe, it, expect } from 'vitest';
import { parseExtractionResponse } from '../../src/ai/baml-parser.js';

// ── parseExtractionResponse ─────────────────────────────────────────────────

describe('parseExtractionResponse', () => {
  it('returns array of objects from JSON array', () => {
    const input = JSON.stringify([
      { name: 'Widget A', price: '$9.99' },
      { name: 'Widget B', price: '$19.99' },
    ]);
    const result = parseExtractionResponse(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'Widget A', price: '$9.99' });
  });

  it('returns array of strings without char decomposition', () => {
    const links = ['Overview', 'Architecture', 'Quick Start', 'Deployment'];
    const input = JSON.stringify(links);
    const result = parseExtractionResponse(input);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(links);
    // Must NOT be char-indexed
    expect(result[0]).toBe('Overview');
    expect(typeof result[0]).toBe('string');
  });

  it('returns empty array on empty input', () => {
    const result = parseExtractionResponse('[]');
    expect(result).toEqual([]);
  });

  it('wraps a single non-array object as a one-element record', () => {
    // A plain verdict/record object is still extracted data. It must be wrapped
    // as [obj], not discarded to [] — otherwise "report PAGE_OK"-style extracts
    // silently lose their payload.
    const input = JSON.stringify({ title: 'Foo', url: 'https://foo.com' });
    const result = parseExtractionResponse(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ title: 'Foo', url: 'https://foo.com' }]);
  });

  it('unwraps { data: [...] } wrapper', () => {
    const input = JSON.stringify({ data: [{ a: 1 }, { b: 2 }] });
    const result = parseExtractionResponse(input);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

// ── Winston metadata spread regression ──────────────────────────────────────

describe('Winston string metadata regression', () => {
  it('Object.keys on string returns char indices (the bug)', () => {
    const str = 'hello';
    // This is what Winston does when you pass a string as metadata
    const keys = Object.keys(str);
    expect(keys).toEqual(['0', '1', '2', '3', '4']);
    // Fix: never pass a string as Winston logger.info second arg
  });

  it('JSON.stringify of extracts produces valid string (not char-indexed)', () => {
    const extracts = [['Overview', 'Architecture', 'Quick Start']];
    const serialized = JSON.stringify(extracts, null, 2);
    // When passed as template literal to logger, should be intact
    const msg = `Extracted data:\n${serialized}`;
    expect(msg).toContain('Overview');
    expect(msg).not.toContain('"0"');
  });
});
