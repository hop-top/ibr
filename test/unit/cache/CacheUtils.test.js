import { describe, it, expect } from 'vitest';
import {
  createDomSignature,
  isDomCompatible,
  extractSchema,
  getValidator,
  validateFindResult,
  validateActionResult,
  validateExtractResult
} from '../../../src/cache/CacheUtils.js';

// --- DOM fixtures ---
const domTree = {
  n: 'div',
  a: { id: 'root' },
  c: [
    { n: 'ul', c: [
      { n: 'li', a: { 'data-testid': 'item-1' } },
      { n: 'li', a: { 'data-testid': 'item-2' } }
    ]}
  ]
};

const domTreeDiff = {
  n: 'section',
  a: { id: 'other' },
  c: [{ n: 'p' }]
};

describe('createDomSignature', () => {
  it('same DOM tree → same hash', () => {
    const h1 = createDomSignature(domTree);
    const h2 = createDomSignature(domTree);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe('string');
    expect(h1.length).toBeGreaterThan(0);
  });

  it('different structure → different hash', () => {
    const h1 = createDomSignature(domTree);
    const h2 = createDomSignature(domTreeDiff);
    expect(h1).not.toBe(h2);
  });

  it('null input → returns a hash (node=null hashes to "null" string)', () => {
    // extractStructure(null) returns null; JSON.stringify(null)="null" → still hashed
    const result = createDomSignature(null);
    expect(typeof result).toBe('string');
    expect(result.length).toBe(64); // sha256 hex
  });
});

describe('isDomCompatible', () => {
  it('same signature → true', () => {
    const sig = createDomSignature(domTree);
    expect(isDomCompatible(sig, sig)).toBe(true);
  });

  it('different signatures → false', () => {
    const s1 = createDomSignature(domTree);
    const s2 = createDomSignature(domTreeDiff);
    expect(isDomCompatible(s1, s2)).toBe(false);
  });

  it('old null → true', () => {
    const sig = createDomSignature(domTree);
    expect(isDomCompatible(null, sig)).toBe(true);
  });

  it('new null → true', () => {
    const sig = createDomSignature(domTree);
    expect(isDomCompatible(sig, null)).toBe(true);
  });

  it('both null → true', () => {
    expect(isDomCompatible(null, null)).toBe(true);
  });
});

describe('extractSchema', () => {
  it('type find → { elementIndices }', () => {
    const result = [{ x: 0 }, { x: 3 }];
    const schema = extractSchema('find', result);
    expect(schema).toEqual({ elementIndices: [0, 3] });
  });

  it('type action → { elementIndices, actionType, actionValue }', () => {
    const result = { elements: [{ x: 1 }], type: 'click', value: null };
    const schema = extractSchema('action', result);
    expect(schema).toEqual({ elementIndices: [1], actionType: 'click', actionValue: null });
  });

  it('type action with value → actionValue populated', () => {
    const result = { elements: [{ x: 2 }], type: 'fill', value: 'hello' };
    const schema = extractSchema('action', result);
    expect(schema.actionValue).toBe('hello');
  });

  it('type extract → { extractionType, itemCount }', () => {
    const result = ['a', 'b', 'c'];
    const schema = extractSchema('extract', result);
    expect(schema).toEqual({ extractionType: 'array', itemCount: 3 });
  });

  it('unknown type → returns null', () => {
    expect(extractSchema('unknown', {})).toBeNull();
  });
});

describe('getValidator', () => {
  it('find → validateFindResult', () => {
    expect(getValidator('find')).toBe(validateFindResult);
  });

  it('action → validateActionResult', () => {
    expect(getValidator('action')).toBe(validateActionResult);
  });

  it('extract → validateExtractResult', () => {
    expect(getValidator('extract')).toBe(validateExtractResult);
  });

  it('unknown → returns fn that returns false', () => {
    const fn = getValidator('nope');
    expect(typeof fn).toBe('function');
    expect(fn({})).toBe(false);
  });
});

describe('validateFindResult', () => {
  it('valid non-empty array → true', () => {
    expect(validateFindResult([{ x: 0 }])).toBe(true);
  });

  it('empty array → false', () => {
    expect(validateFindResult([])).toBe(false);
  });

  it('null → false', () => {
    expect(validateFindResult(null)).toBe(false);
  });
});

describe('validateActionResult', () => {
  it('valid result → truthy', () => {
    // returns result.type (last truthy value in &&-chain), not strict boolean
    expect(validateActionResult({ elements: [{ x: 0 }], type: 'click' })).toBeTruthy();
  });

  it('empty elements → falsy', () => {
    expect(validateActionResult({ elements: [], type: 'click' })).toBeFalsy();
  });

  it('missing type → falsy', () => {
    expect(validateActionResult({ elements: [{ x: 0 }] })).toBeFalsy();
  });

  it('null → falsy', () => {
    expect(validateActionResult(null)).toBeFalsy();
  });
});

describe('validateExtractResult', () => {
  it('non-empty array → true', () => {
    expect(validateExtractResult(['item'])).toBe(true);
  });

  it('empty array → false', () => {
    expect(validateExtractResult([])).toBe(false);
  });

  it('null → false', () => {
    expect(validateExtractResult(null)).toBe(false);
  });
});
