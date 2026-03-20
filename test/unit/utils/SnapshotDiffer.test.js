/**
 * Unit tests for SnapshotDiffer — regression coverage for Copilot review fixes.
 *
 * Fixes covered:
 *   1. computeDiff with empty history → returns {largeChange:true}, does NOT throw
 *   2. semanticAttrs includes id / name / content changes in modified detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotDiffer } from '../../../src/utils/SnapshotDiffer.js';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal DOM tree with a single node at index 0. */
function makeTree(attrs = {}) {
  return {
    x: 0,
    n: 'DIV',
    t: '',
    a: attrs,
    c: [],
  };
}

// ── computeDiff — empty history guard ─────────────────────────────────────────

describe('SnapshotDiffer.computeDiff — empty history guard', () => {
  it('returns {largeChange:true} when no captureSnapshot has been called (dom mode)', () => {
    const differ = new SnapshotDiffer();
    // Must NOT throw; must return an object with largeChange=true
    let result;
    expect(() => {
      result = differ.computeDiff(makeTree(), ['/HTML/BODY/DIV']);
    }).not.toThrow();
    expect(result).toBeDefined();
    expect(result.largeChange).toBe(true);
  });

  it('returns {largeChange:true} when no captureSnapshot has been called (aria mode)', () => {
    const differ = new SnapshotDiffer();
    let result;
    expect(() => {
      result = differ.computeDiff('- heading "Page Title"', null);
    }).not.toThrow();
    expect(result.largeChange).toBe(true);
  });

  it('returns added/removed/modified arrays (empty) alongside largeChange:true', () => {
    const differ = new SnapshotDiffer();
    const result = differ.computeDiff(makeTree(), ['/HTML/BODY/DIV']);
    expect(Array.isArray(result.added)).toBe(true);
    expect(Array.isArray(result.removed)).toBe(true);
    expect(Array.isArray(result.modified)).toBe(true);
  });

  it('returns largeChange:false after a valid captureSnapshot baseline exists', () => {
    const differ = new SnapshotDiffer();
    const tree = makeTree({ id: 'root' });
    differ.captureSnapshot(tree, ['/HTML/BODY/DIV']);
    // Same tree → no changes → largeChange should be false
    const result = differ.computeDiff(tree, ['/HTML/BODY/DIV']);
    expect(result.largeChange).toBe(false);
  });
});

// ── semanticAttrs — id / name / content detected in modified ─────────────────

describe('SnapshotDiffer.computeDiff — semanticAttrs includes id/name/content', () => {
  let differ;

  beforeEach(() => {
    differ = new SnapshotDiffer();
  });

  it('detects id attribute change as a modified node', () => {
    const prev = makeTree({ id: 'old-id' });
    const curr = makeTree({ id: 'new-id' });

    differ.captureSnapshot(prev, ['/HTML/BODY/DIV']);
    const result = differ.computeDiff(curr, ['/HTML/BODY/DIV']);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes.a).toHaveProperty('id');
    expect(result.modified[0].changes.a.id).toEqual(['old-id', 'new-id']);
  });

  it('detects name attribute change as a modified node', () => {
    const prev = makeTree({ name: 'username' });
    const curr = makeTree({ name: 'email' });

    differ.captureSnapshot(prev, ['/HTML/BODY/DIV']);
    const result = differ.computeDiff(curr, ['/HTML/BODY/DIV']);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes.a).toHaveProperty('name');
    expect(result.modified[0].changes.a.name).toEqual(['username', 'email']);
  });

  it('detects content attribute change as a modified node', () => {
    const prev = makeTree({ content: 'Page description v1' });
    const curr = makeTree({ content: 'Page description v2' });

    differ.captureSnapshot(prev, ['/HTML/BODY/DIV']);
    const result = differ.computeDiff(curr, ['/HTML/BODY/DIV']);

    expect(result.modified).toHaveLength(1);
    expect(result.modified[0].changes.a).toHaveProperty('content');
    expect(result.modified[0].changes.a.content).toEqual([
      'Page description v1',
      'Page description v2',
    ]);
  });

  it('does NOT flag as modified when id/name/content are unchanged', () => {
    const attrs = { id: 'stable', name: 'field', content: 'same' };
    const prev = makeTree(attrs);
    const curr = makeTree({ ...attrs });

    differ.captureSnapshot(prev, ['/HTML/BODY/DIV']);
    const result = differ.computeDiff(curr, ['/HTML/BODY/DIV']);

    expect(result.modified).toHaveLength(0);
  });

  it('regression: id absent from semanticAttrs would miss id changes', () => {
    // If id were missing from semanticAttrs, this diff would return modified=[]
    // After the fix it must detect the change.
    const prev = makeTree({ id: 'before' });
    const curr = makeTree({ id: 'after' });

    differ.captureSnapshot(prev, ['/HTML/BODY/DIV']);
    const result = differ.computeDiff(curr, ['/HTML/BODY/DIV']);

    // Would be 0 before fix; must be 1 after fix
    expect(result.modified.length).toBeGreaterThan(0);
  });
});

// ── shouldUseDiff integration ─────────────────────────────────────────────────

describe('SnapshotDiffer.shouldUseDiff', () => {
  it('returns false when history is empty', () => {
    const differ = new SnapshotDiffer();
    expect(differ.shouldUseDiff()).toBe(false);
  });

  it('returns true after captureSnapshot called', () => {
    const differ = new SnapshotDiffer();
    differ.captureSnapshot(makeTree(), ['/HTML/BODY/DIV']);
    expect(differ.shouldUseDiff()).toBe(true);
  });

  it('returns false after reset()', () => {
    const differ = new SnapshotDiffer();
    differ.captureSnapshot(makeTree(), ['/HTML/BODY/DIV']);
    differ.reset();
    expect(differ.shouldUseDiff()).toBe(false);
  });
});
