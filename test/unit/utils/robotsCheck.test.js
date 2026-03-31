import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseRobotsTxt, isAllowedByDirectives, checkRobots } from '../../../src/utils/robotsCheck.js';

// ── parseRobotsTxt ────────────────────────────────────────────────────────────

describe('parseRobotsTxt', () => {
  it('parses a simple wildcard block', () => {
    const txt = `
User-agent: *
Disallow: /private/
Allow: /public/
    `.trim();
    const blocks = parseRobotsTxt(txt);
    expect(blocks.get('*')).toEqual([
      { type: 'Disallow', path: '/private/' },
      { type: 'Allow', path: '/public/' },
    ]);
  });

  it('parses multiple user-agent blocks', () => {
    const txt = `
User-agent: *
Disallow: /admin/

User-agent: ibr
Disallow: /secret/
    `.trim();
    const blocks = parseRobotsTxt(txt);
    expect(blocks.get('*')).toEqual([{ type: 'Disallow', path: '/admin/' }]);
    expect(blocks.get('ibr')).toEqual([{ type: 'Disallow', path: '/secret/' }]);
  });

  it('strips inline comments from lines', () => {
    const txt = 'User-agent: * # all bots\nDisallow: /no/ # off-limits';
    const blocks = parseRobotsTxt(txt);
    expect(blocks.get('*')).toEqual([{ type: 'Disallow', path: '/no/' }]);
  });

  it('handles empty file', () => {
    const blocks = parseRobotsTxt('');
    expect(blocks.size).toBe(0);
  });
});

// ── isAllowedByDirectives ─────────────────────────────────────────────────────

describe('isAllowedByDirectives', () => {
  it('allows path not matching any directive', () => {
    const dirs = [{ type: 'Disallow', path: '/private/' }];
    expect(isAllowedByDirectives('/public/page', dirs)).toBe(true);
  });

  it('disallows path matching a Disallow directive', () => {
    const dirs = [{ type: 'Disallow', path: '/private/' }];
    expect(isAllowedByDirectives('/private/page', dirs)).toBe(false);
  });

  it('allows path matching an Allow directive', () => {
    const dirs = [{ type: 'Allow', path: '/public/' }];
    expect(isAllowedByDirectives('/public/page', dirs)).toBe(true);
  });

  it('Allow on more-specific path overrides Disallow on shorter path', () => {
    const dirs = [
      { type: 'Disallow', path: '/products/' },
      { type: 'Allow', path: '/products/public/' },
    ];
    // /products/public/item matches both; Allow is more specific → allowed
    expect(isAllowedByDirectives('/products/public/item', dirs)).toBe(true);
    // /products/secret/item matches only Disallow → disallowed
    expect(isAllowedByDirectives('/products/secret/item', dirs)).toBe(false);
  });

  it('empty Disallow path means allow all', () => {
    const dirs = [{ type: 'Disallow', path: '' }];
    expect(isAllowedByDirectives('/anything', dirs)).toBe(true);
  });

  it('same-length Allow wins over Disallow (RFC 9309 tie-break)', () => {
    // Both match /page exactly, Allow should win
    const dirs = [
      { type: 'Disallow', path: '/page' },
      { type: 'Allow', path: '/page' },
    ];
    expect(isAllowedByDirectives('/page', dirs)).toBe(true);
  });
});

// ── checkRobots ───────────────────────────────────────────────────────────────

describe('checkRobots', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disallowed path returns { allowed: false }', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'User-agent: *\nDisallow: /private/',
    });
    const result = await checkRobots('https://example.com/private/page');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('disallowed-by-robots');
  });

  it('allowed path returns { allowed: true }', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'User-agent: *\nDisallow: /admin/',
    });
    const result = await checkRobots('https://example.com/public/page');
    expect(result.allowed).toBe(true);
  });

  it('robots.txt 404 returns { allowed: true } (warn + continue)', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => '',
    });
    const result = await checkRobots('https://example.com/any/path');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('not-found');
  });

  it('network error returns { allowed: true } (warn + continue)', async () => {
    fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await checkRobots('https://example.com/any/path');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('fetch-error');
  });

  it('non-404 HTTP error returns { allowed: true }', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => '',
    });
    const result = await checkRobots('https://example.com/any/path');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('http-503');
  });

  it('User-agent: ibr block takes precedence over User-agent: *', async () => {
    const robotsTxt = [
      'User-agent: *',
      'Allow: /private/',
      '',
      'User-agent: ibr',
      'Disallow: /private/',
    ].join('\n');

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    // Wildcard allows /private/, but ibr block disallows it → ibr wins
    const result = await checkRobots('https://example.com/private/page');
    expect(result.allowed).toBe(false);
  });

  it('Allow directive overrides Disallow for more-specific paths', async () => {
    const robotsTxt = [
      'User-agent: *',
      'Disallow: /products/',
      'Allow: /products/public/',
    ].join('\n');

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => robotsTxt,
    });

    const result = await checkRobots('https://example.com/products/public/item');
    expect(result.allowed).toBe(true);
  });

  it('handles invalid URL gracefully', async () => {
    const result = await checkRobots('not-a-url');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('invalid-url');
  });
});
