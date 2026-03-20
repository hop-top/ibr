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

// --- ARIA snapshot fixtures ---
const ariaSnapshot = `- heading "Products" [level=1]
- list
  - listitem
    - button "Add to cart"
  - listitem
    - button "Add to cart"
- link "Checkout"`;

const ariaSnapshotDiff = `- heading "Sign In" [level=1]
- textbox "Email"
- textbox "Password"
- button "Sign In"`;

describe('createDomSignature', () => {
  it('same ARIA snapshot → same hash', () => {
    const h1 = createDomSignature(ariaSnapshot);
    const h2 = createDomSignature(ariaSnapshot);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe('string');
    expect(h1.length).toBeGreaterThan(0);
  });

  it('different structure → different hash', () => {
    const h1 = createDomSignature(ariaSnapshot);
    const h2 = createDomSignature(ariaSnapshotDiff);
    expect(h1).not.toBe(h2);
  });

  it('null input → returns null', () => {
    const result = createDomSignature(null);
    expect(result).toBeNull();
  });
});

describe('isDomCompatible', () => {
  it('same signature → true', () => {
    const sig = createDomSignature(ariaSnapshot);
    expect(isDomCompatible(sig, sig)).toBe(true);
  });

  it('different signatures → false', () => {
    const s1 = createDomSignature(ariaSnapshot);
    const s2 = createDomSignature(ariaSnapshotDiff);
    expect(isDomCompatible(s1, s2)).toBe(false);
  });

  it('old null → true', () => {
    const sig = createDomSignature(ariaSnapshot);
    expect(isDomCompatible(null, sig)).toBe(true);
  });

  it('new null → true', () => {
    const sig = createDomSignature(ariaSnapshot);
    expect(isDomCompatible(sig, null)).toBe(true);
  });

  it('both null → true', () => {
    expect(isDomCompatible(null, null)).toBe(true);
  });
});

describe('extractSchema', () => {
  it('type find → { elementDescriptors }', () => {
    const result = [{ role: 'button', name: 'Sign in' }, { role: 'link', name: 'Learn more' }];
    const schema = extractSchema('find', result);
    expect(schema).toEqual({
      elementDescriptors: [
        { role: 'button', name: 'Sign in' },
        { role: 'link', name: 'Learn more' }
      ]
    });
  });

  it('type action → { elementDescriptors, actionType, actionValue }', () => {
    const result = { elements: [{ role: 'button', name: 'Submit' }], type: 'click', value: null };
    const schema = extractSchema('action', result);
    expect(schema).toEqual({
      elementDescriptors: [{ role: 'button', name: 'Submit' }],
      actionType: 'click',
      actionValue: null
    });
  });

  it('type action with value → actionValue populated', () => {
    const result = { elements: [{ role: 'textbox', name: 'Email' }], type: 'fill', value: 'hello' };
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
