/**
 * Tests for capability-signature.js (T-0031).
 */

import { describe, it, expect } from 'vitest';
import {
  signature,
  normalizeStepTemplate,
  canonicalSelector,
  OP_KINDS,
} from '../../../src/browser/capability-signature.js';

const SEL = { role: 'button', tagName: 'button', hasText: true, depth: 3 };

describe('capability-signature — opKind enum', () => {
  it('accepts every member of OP_KINDS', () => {
    for (const k of OP_KINDS) {
      const sig = signature({ opKind: k, selector: SEL, stepTemplate: 'click submit' });
      expect(sig).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('throws on unknown opKind', () => {
    expect(() =>
      signature({ opKind: 'frobnicate', selector: SEL, stepTemplate: 'do thing' }),
    ).toThrow(/unknown opKind/);
  });

  it('includes "launch" in the enum', () => {
    expect(OP_KINDS).toContain('launch');
  });
});

describe('capability-signature — normalizeStepTemplate', () => {
  it('lowercases input', () => {
    expect(normalizeStepTemplate('CLICK Submit Button'))
      .toBe('button click submit');
  });

  it('strips URLs', () => {
    expect(normalizeStepTemplate('open https://example.com/path?x=1 page'))
      .toBe('open page');
  });

  it('strips numbers', () => {
    expect(normalizeStepTemplate('click button 42 next 7 times'))
      .toBe('button click next times');
  });

  it('strips quoted strings (single and double)', () => {
    expect(normalizeStepTemplate(`fill "user name" 'pw' field`))
      .toBe('field fill');
  });

  it('drops stopwords', () => {
    expect(normalizeStepTemplate('click on the submit button for a form'))
      .toBe('button click form submit');
  });

  it('sorts and joins with single space', () => {
    const out = normalizeStepTemplate('zebra apple mango');
    expect(out).toBe('apple mango zebra');
  });

  it('handles null/empty', () => {
    expect(normalizeStepTemplate(null)).toBe('');
    expect(normalizeStepTemplate('')).toBe('');
  });
});

describe('capability-signature — canonicalSelector shape', () => {
  it('accepts a valid structural selector', () => {
    const out = canonicalSelector({ role: 'link', tagName: 'a', hasText: false, depth: 0 });
    expect(out).toEqual({ role: 'link', tagName: 'a', hasText: false, depth: 0 });
  });

  it('coerces missing role to null', () => {
    const out = canonicalSelector({ tagName: 'div', hasText: true, depth: 1 });
    expect(out.role).toBeNull();
  });

  it('throws on missing tagName', () => {
    expect(() => canonicalSelector({ hasText: false, depth: 0 })).toThrow(/tagName/);
  });

  it('throws on non-boolean hasText', () => {
    expect(() =>
      canonicalSelector({ tagName: 'p', hasText: 'yes', depth: 0 }),
    ).toThrow(/hasText/);
  });

  it('throws on non-integer depth', () => {
    expect(() =>
      canonicalSelector({ tagName: 'p', hasText: true, depth: 'deep' }),
    ).toThrow(/depth/);
  });

  it('throws on non-object input', () => {
    expect(() => canonicalSelector(null)).toThrow(/structural object/);
    expect(() => canonicalSelector('button')).toThrow(/structural object/);
  });
});

describe('capability-signature — signature determinism', () => {
  it('shuffled selector keys produce same hash', () => {
    const a = signature({
      opKind: 'click',
      selector: { role: 'button', tagName: 'button', hasText: true, depth: 2 },
      stepTemplate: 'click submit',
    });
    const b = signature({
      opKind: 'click',
      selector: { depth: 2, hasText: true, tagName: 'button', role: 'button' },
      stepTemplate: 'click submit',
    });
    expect(a).toBe(b);
  });

  it('equivalent step text via normalization produces same hash', () => {
    const a = signature({
      opKind: 'fill',
      selector: SEL,
      stepTemplate: 'Fill the username field',
    });
    const b = signature({
      opKind: 'fill',
      selector: SEL,
      stepTemplate: 'fill username field',
    });
    expect(a).toBe(b);
  });

  it('URL/number/quote variations collapse to same hash', () => {
    const a = signature({
      opKind: 'goto',
      selector: SEL,
      stepTemplate: 'Navigate to https://foo.example.com/page/123',
    });
    const b = signature({
      opKind: 'goto',
      selector: SEL,
      stepTemplate: 'Navigate to https://bar.example.org/other/999',
    });
    expect(a).toBe(b);
  });

  it('different opKinds produce different hashes', () => {
    const a = signature({ opKind: 'click', selector: SEL, stepTemplate: 'submit' });
    const b = signature({ opKind: 'fill', selector: SEL, stepTemplate: 'submit' });
    expect(a).not.toBe(b);
  });

  it('returns sha256:<hex> format', () => {
    const out = signature({ opKind: 'click', selector: SEL, stepTemplate: 'submit' });
    expect(out).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
