/**
 * Unit tests for ariaSimplifier — selectMode, assessQuality, resolveElement
 */

import { describe, it, expect, vi } from 'vitest';
import { selectMode, assessQuality, SIZE_THRESHOLD, SPARSITY_THRESHOLD } from '../../../src/utils/ariaSimplifier.js';

// ── selectMode ────────────────────────────────────────────────────────────────

describe('selectMode — forced="aria" with null/missing snapshot', () => {
  it('null snapshot → {mode:"dom", reason:"forced-aria-unavailable"}', () => {
    const result = selectMode(null, 'aria');
    expect(result).toEqual({ mode: 'dom', reason: 'forced-aria-unavailable' });
  });

  it('undefined snapshot → {mode:"dom", reason:"forced-aria-unavailable"}', () => {
    const result = selectMode(undefined, 'aria');
    expect(result).toEqual({ mode: 'dom', reason: 'forced-aria-unavailable' });
  });

  it('non-string snapshot (number) → {mode:"dom", reason:"forced-aria-unavailable"}', () => {
    // typeof 42 !== 'string' — same guard path
    const result = selectMode(42, 'aria');
    expect(result).toEqual({ mode: 'dom', reason: 'forced-aria-unavailable' });
  });

  it('valid string snapshot → {mode:"aria", reason:"forced"}', () => {
    const result = selectMode('- button "OK"', 'aria');
    expect(result).toEqual({ mode: 'aria', reason: 'forced' });
  });

  // Regression: if the null-guard is removed, selectMode with forced='aria'+null
  // would either propagate null or return {mode:'aria'} with a null context.
  // This test pair proves the fix is load-bearing.
  it('regression: forced="aria"+null must NOT return mode="aria"', () => {
    expect(selectMode(null, 'aria').mode).toBe('dom');
  });
});

describe('selectMode — forced="dom"', () => {
  it('always returns dom regardless of snapshot', () => {
    expect(selectMode('- button "OK"', 'dom')).toEqual({ mode: 'dom', reason: 'forced' });
    expect(selectMode(null, 'dom')).toEqual({ mode: 'dom', reason: 'forced' });
  });
});

describe('selectMode — auto mode', () => {
  it('null snapshot → dom/empty', () => {
    expect(selectMode(null)).toEqual({ mode: 'dom', reason: 'empty' });
  });

  it('empty string → dom/empty', () => {
    expect(selectMode('')).toEqual({ mode: 'dom', reason: 'empty' });
  });

  it('whitespace-only → dom/empty', () => {
    expect(selectMode('   \n  ')).toEqual({ mode: 'dom', reason: 'empty' });
  });

  it('oversized snapshot → dom/size', () => {
    const big = 'x'.repeat(SIZE_THRESHOLD + 1);
    const result = selectMode(big);
    expect(result).toEqual({ mode: 'dom', reason: 'size' });
  });

  it('high sparsity → dom/sparse', () => {
    // All unnamed interactive elements → sparsity = 1.0 > 0.4
    const sparse = [
      '- button',
      '- button',
      '- link',
      '- textbox',
    ].join('\n');
    const result = selectMode(sparse);
    expect(result.mode).toBe('dom');
    expect(result.reason).toMatch(/^sparse/);
  });

  it('good quality snapshot → aria/quality ok', () => {
    const good = [
      '- button "Sign in"',
      '- link "Home"',
      '- textbox "Email"',
    ].join('\n');
    const result = selectMode(good);
    expect(result).toEqual({ mode: 'aria', reason: 'quality ok' });
  });
});

// ── assessQuality ─────────────────────────────────────────────────────────────

describe('assessQuality', () => {
  it('null → {empty:true}', () => {
    expect(assessQuality(null)).toEqual({ sparsityRatio: 0, tooLarge: false, empty: true });
  });

  it('oversized → {tooLarge:true}', () => {
    const big = 'x'.repeat(SIZE_THRESHOLD + 1);
    expect(assessQuality(big)).toEqual({ sparsityRatio: 0, tooLarge: true, empty: false });
  });

  it('all named interactive → sparsityRatio=0', () => {
    const snap = '- button "OK"\n- link "Go"';
    const { sparsityRatio } = assessQuality(snap);
    expect(sparsityRatio).toBe(0);
  });

  it('all unnamed interactive → sparsityRatio=1', () => {
    const snap = '- button\n- link';
    const { sparsityRatio } = assessQuality(snap);
    expect(sparsityRatio).toBe(1);
  });

  it('no interactive roles → sparsityRatio=0 (not empty)', () => {
    const snap = '- heading "Title"\n- paragraph "text"';
    const { sparsityRatio, empty } = assessQuality(snap);
    expect(sparsityRatio).toBe(0);
    expect(empty).toBe(false);
  });
});
