/**
 * Unit tests for parseDomArgs — high-precision error messages (T-0013)
 */

import { describe, it, expect } from 'vitest';
import { parseDomArgs } from '../../src/commands/snap.js';

describe('parseDomArgs — high-precision errors', () => {
  // ── missing URL ────────────────────────────────────────────────────────────

  it('throws when no URL given — includes Usage + Example in message', () => {
    expect(() => parseDomArgs([])).toThrow('snap subcommand requires a URL argument');
  });

  it('missing URL error includes Usage hint', () => {
    expect(() => parseDomArgs([])).toThrow('Usage: idx snap <url> [flags]');
  });

  it('missing URL error includes Example', () => {
    expect(() => parseDomArgs([])).toThrow('Example: idx snap https://example.com -i');
  });

  // ── -d flag ────────────────────────────────────────────────────────────────

  it('throws when -d has no next arg — includes numeric example', () => {
    expect(() => parseDomArgs(['-d'])).toThrow('-d requires a numeric depth argument');
  });

  it('-d error includes example value', () => {
    expect(() => parseDomArgs(['-d'])).toThrow('e.g. -d 5');
  });

  it('-d error mentions what depth controls', () => {
    expect(() => parseDomArgs(['-d'])).toThrow('DOM levels');
  });

  it('throws when -d value is non-numeric', () => {
    expect(() => parseDomArgs(['-d', 'abc', 'https://example.com']))
      .toThrow('-d requires a numeric depth argument');
  });

  it('accepts valid -d value', () => {
    const opts = parseDomArgs(['https://example.com', '-d', '3']);
    expect(opts.depth).toBe(3);
  });

  // ── -s flag ────────────────────────────────────────────────────────────────

  it('throws when -s has no next arg — includes selector example', () => {
    expect(() => parseDomArgs(['-s'])).toThrow('-s requires a CSS selector argument');
  });

  it('-s error includes example selector', () => {
    expect(() => parseDomArgs(['-s'])).toThrow('#main-content');
  });

  it('-s error mentions scope behavior', () => {
    expect(() => parseDomArgs(['-s'])).toThrow('subtree rooted at the matching element');
  });

  it('accepts valid -s value', () => {
    const opts = parseDomArgs(['https://example.com', '-s', '#main']);
    expect(opts.selector).toBe('#main');
  });

  // ── happy paths ─────────────────────────────────────────────────────────────

  it('parses URL correctly', () => {
    const opts = parseDomArgs(['https://example.com']);
    expect(opts.url).toBe('https://example.com');
  });

  it('parses -i flag', () => {
    const opts = parseDomArgs(['https://example.com', '-i']);
    expect(opts.interactive).toBe(true);
  });

  it('parses --aria flag', () => {
    const opts = parseDomArgs(['--aria', 'https://example.com']);
    expect(opts.aria).toBe(true);
  });
});
