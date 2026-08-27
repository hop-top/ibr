/**
 * Tests for chromium-fallback.js (T-0109).
 *
 * When Playwright's pinned chromium_headless_shell build is absent from the
 * ms-playwright cache, chromium.launch() throws "Executable doesn't exist".
 * These tests pin the fallback-candidate enumeration:
 *   - already-cached ms-playwright chromium builds are found (newest rev first)
 *   - system chromium-family channels are offered after cached builds
 *   - the actionable install hint names `npx playwright install chromium`
 *     and lists what was searched
 *   - isMissingBrowserError() only matches the pinned-build failure
 */

import { describe, it, expect } from 'vitest';
import path from 'path';

import {
  listCachedChromiumBuilds,
  buildFallbackCandidates,
  chromiumInstallHint,
  isMissingBrowserError,
} from '../../../src/browser/chromium-fallback.js';

const ROOT = '/home/u/.cache/ms-playwright';

// A fake exists() over a virtual ms-playwright cache with three chromium
// builds present (1200, 1223, 1234) but the pinned 1217 absent.
function makeExists(present) {
  const set = new Set(present);
  return (p) => set.has(p);
}

// The mac-arm64 headless-shell exec path for a given revision.
function shellPath(root, rev) {
  return path.join(
    root,
    `chromium_headless_shell-${rev}`,
    'chrome-headless-shell-mac-arm64',
    'chrome-headless-shell',
  );
}

describe('chromium-fallback — listCachedChromiumBuilds', () => {
  it('returns cached headless-shell builds newest-revision first', () => {
    const readdir = () => [
      'chromium-1200',
      'chromium_headless_shell-1200',
      'chromium-1223',
      'chromium_headless_shell-1223',
      'chromium-1234',
      'chromium_headless_shell-1234',
      'ffmpeg-1011',
      '.links',
    ];
    const exists = makeExists([
      shellPath(ROOT, 1200),
      shellPath(ROOT, 1223),
      shellPath(ROOT, 1234),
    ]);

    const builds = listCachedChromiumBuilds(ROOT, {
      platform: 'darwin',
      arch: 'arm64',
      readdir,
      exists,
    });

    expect(builds.map((b) => b.revision)).toEqual([1234, 1223, 1200]);
    expect(builds[0].executablePath).toBe(shellPath(ROOT, 1234));
  });

  it('skips revisions whose executable is not actually on disk', () => {
    const readdir = () => ['chromium_headless_shell-1234', 'chromium_headless_shell-1223'];
    // Only 1223 present on disk; 1234 dir exists but binary missing.
    const exists = makeExists([shellPath(ROOT, 1223)]);

    const builds = listCachedChromiumBuilds(ROOT, {
      platform: 'darwin',
      arch: 'arm64',
      readdir,
      exists,
    });

    expect(builds.map((b) => b.revision)).toEqual([1223]);
  });

  it('returns [] when the cache dir cannot be read', () => {
    const readdir = () => {
      throw new Error('ENOENT');
    };
    const builds = listCachedChromiumBuilds(ROOT, {
      platform: 'darwin',
      arch: 'arm64',
      readdir,
      exists: () => false,
    });
    expect(builds).toEqual([]);
  });
});

describe('chromium-fallback — buildFallbackCandidates', () => {
  it('orders cached ms-playwright builds ahead of system channels', () => {
    const readdir = () => ['chromium_headless_shell-1234', 'chromium_headless_shell-1200'];
    const exists = makeExists([
      shellPath(ROOT, 1234),
      shellPath(ROOT, 1200),
      // a system chrome install so a channel candidate is also viable
    ]);

    const candidates = buildFallbackCandidates({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      cacheRoot: ROOT,
      readdir,
      exists,
    });

    // First candidate must be the newest cached build (executablePath).
    expect(candidates[0]).toMatchObject({
      source: 'ms-playwright-cache',
      executablePath: shellPath(ROOT, 1234),
    });
    // A system channel (chrome/msedge) must appear later as a channel candidate.
    const channels = candidates.filter((c) => c.channel).map((c) => c.channel);
    expect(channels).toContain('chrome');
  });

  it('offers only system channels when the cache has no chromium builds', () => {
    const readdir = () => ['ffmpeg-1011'];
    const candidates = buildFallbackCandidates({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      cacheRoot: ROOT,
      readdir,
      exists: () => false,
    });
    expect(candidates.every((c) => c.channel && !c.executablePath)).toBe(true);
    expect(candidates.map((c) => c.channel)).toContain('chrome');
  });
});

describe('chromium-fallback — chromiumInstallHint', () => {
  it('names the exact install command and lists what was searched', () => {
    const hint = chromiumInstallHint({
      searched: ['ms-playwright cache (none present)', 'chrome', 'msedge'],
    });
    expect(hint).toMatch(/npx playwright install chromium/);
    expect(hint).toMatch(/ms-playwright cache/);
    expect(hint).toMatch(/chrome/);
  });
});

describe('chromium-fallback — isMissingBrowserError', () => {
  it('matches Playwright\'s pinned-build "Executable doesn\'t exist" error', () => {
    const err = new Error(
      "browserType.launch: Executable doesn't exist at " +
        '/home/u/.cache/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell',
    );
    expect(isMissingBrowserError(err)).toBe(true);
  });

  it('does NOT match unrelated launch errors', () => {
    expect(isMissingBrowserError(new Error('Target page crashed'))).toBe(false);
    expect(isMissingBrowserError(new Error('connect ECONNREFUSED'))).toBe(false);
    expect(isMissingBrowserError(null)).toBe(false);
  });
});
