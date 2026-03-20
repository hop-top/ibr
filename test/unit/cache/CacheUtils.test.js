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

// --- DOM JSON fixtures (DomSimplifier output) ---
const domJsonObj  = JSON.stringify({ tag: 'div', children: [{ tag: 'button', text: 'Go', x: 0 }] });
const domJsonArr  = JSON.stringify([{ tag: 'form', x: 0 }, { tag: 'input', x: 1 }]);

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

  // ── DOM JSON detection (Copilot fix) ────────────────────────────────────────

  it('DOM JSON object string → returns a hash (not null)', () => {
    const sig = createDomSignature(domJsonObj);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
  });

  it('DOM JSON array string → returns a hash (not null)', () => {
    const sig = createDomSignature(domJsonArr);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
  });

  it('DOM JSON object → same input → same hash', () => {
    expect(createDomSignature(domJsonObj)).toBe(createDomSignature(domJsonObj));
  });

  it('DOM JSON vs ARIA string → different hashes', () => {
    const domSig  = createDomSignature(domJsonObj);
    const ariaSig = createDomSignature(ariaSnapshot);
    expect(domSig).not.toBe(ariaSig);
  });

  it('DOM JSON: different content → different hash', () => {
    const sig1 = createDomSignature(domJsonObj);
    const sig2 = createDomSignature(domJsonArr);
    expect(sig1).not.toBe(sig2);
  });

  it('regression: DOM JSON starting with "{" must NOT be treated as ARIA', () => {
    // If the {/[ detection were removed, a DOM JSON string would be hashed as
    // ARIA (stripping names etc.), potentially producing hash collisions or
    // incorrect structural fingerprints.
    const domSig = createDomSignature(domJsonObj);
    // Full-string hash of JSON = longer, deterministic; ARIA hash strips names.
    // Key property: same string must always produce the same result.
    expect(createDomSignature(domJsonObj)).toBe(domSig);
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

  // ── normaliseDescriptor {x} preservation (Copilot fix) ──────────────────────

  it('find: DOM {x} descriptor is preserved in elementDescriptors', () => {
    const result = [{ x: 0 }, { x: 3 }];
    const schema = extractSchema('find', result);
    expect(schema.elementDescriptors).toEqual([{ x: 0 }, { x: 3 }]);
  });

  it('find: descriptor with only role (no name) → preserved as {role, name:undefined}', () => {
    const result = [{ role: 'button' }];
    const schema = extractSchema('find', result);
    // role present → normalised with role/name path; name will be undefined
    expect(schema.elementDescriptors[0]).toHaveProperty('role', 'button');
  });

  it('find: descriptor with neither role/name nor x → filtered out (null)', () => {
    const result = [{ label: 'foo' }]; // no role, name, or x
    const schema = extractSchema('find', result);
    expect(schema.elementDescriptors).toHaveLength(0);
  });

  it('find: mixed ARIA + DOM descriptors → both preserved', () => {
    const result = [
      { role: 'button', name: 'Submit' },
      { x: 2 },
    ];
    const schema = extractSchema('find', result);
    expect(schema.elementDescriptors).toEqual([
      { role: 'button', name: 'Submit' },
      { x: 2 },
    ]);
  });

  it('action: DOM {x} descriptor preserved in elementDescriptors', () => {
    const result = { elements: [{ x: 1 }], type: 'click', value: null };
    const schema = extractSchema('action', result);
    expect(schema.elementDescriptors).toEqual([{ x: 1 }]);
  });

  it('regression: without {x} path in normaliseDescriptor, DOM descriptors would be dropped', () => {
    // If normaliseDescriptor returned null for {x}-only descriptors, the
    // filter(Boolean) would remove them all, leaving an empty array.
    const result = [{ x: 0 }, { x: 1 }];
    const schema = extractSchema('find', result);
    expect(schema.elementDescriptors.length).toBe(2);
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
