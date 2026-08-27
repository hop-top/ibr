/**
 * Tests for resolver.js chromium pinned-build fallback (T-0109).
 *
 * Reproduces the T-0083 incident: Playwright's pinned chromium_headless_shell
 * build is absent from the ms-playwright cache, so chromium.launch() throws
 * "Executable doesn't exist" — despite other cached chromium builds present.
 *
 * Covers:
 *   (a) pinned build missing + an alternate cached build present
 *       → resolver retries the alternate and resolves (asserts which path)
 *   (b) pinned missing + nothing available
 *       → throws an error whose message names `npx playwright install chromium`
 *   (c) a hard override (BROWSER_EXECUTABLE_PATH) launch failure is surfaced,
 *       NOT masked by the fallback (error propagates, not swallowed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';

const launchMock = vi.fn();
vi.mock('../../../src/browser/launchers/playwright-launch.js', () => ({
  launch: (...args) => launchMock(...args),
}));

// Deterministic fallback surface: one cached ms-playwright build present.
const CACHED_PATH = '/cache/ms-playwright/chromium_headless_shell-1234/x/chrome-headless-shell';
const fallbackCandidatesMock = vi.fn();
vi.mock('../../../src/browser/chromium-fallback.js', async () => {
  const actual = await vi.importActual('../../../src/browser/chromium-fallback.js');
  return {
    ...actual,
    buildFallbackCandidates: (...args) => fallbackCandidatesMock(...args),
  };
});

import { resolve } from '../../../src/browser/resolver.js';

let stderrSpy;
let platformSpy;

function missingBuildError() {
  return new Error(
    "browserType.launch: Executable doesn't exist at " +
      '/cache/ms-playwright/chromium_headless_shell-1217/x/chrome-headless-shell',
  );
}

beforeEach(() => {
  launchMock.mockReset();
  fallbackCandidatesMock.mockReset().mockReturnValue([]);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  platformSpy = vi.spyOn(os, 'platform').mockReturnValue('darwin');
});

afterEach(() => {
  stderrSpy.mockRestore();
  platformSpy.mockRestore();
});

function ndjson() {
  return stderrSpy.mock.calls
    .map((c) => c[0])
    .filter((s) => typeof s === 'string')
    .flatMap((s) => s.split('\n').filter(Boolean))
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

describe('resolver — chromium pinned-build fallback', () => {
  it('(a) pinned missing + cached alternate present → resolves to the alternate', async () => {
    // First launch (default pinned build) fails with the missing-build error;
    // the retry on the cached executablePath succeeds.
    launchMock
      .mockRejectedValueOnce(missingBuildError())
      .mockResolvedValueOnce({ browser: { close: vi.fn() }, context: null, close: vi.fn() });

    fallbackCandidatesMock.mockReturnValue([
      { source: 'ms-playwright-cache', executablePath: CACHED_PATH, revision: 1234 },
    ]);

    const handle = await resolve({}, {});

    expect(launchMock).toHaveBeenCalledTimes(2);
    // First call is the default (no executablePath); the retry carries the
    // cached build's executablePath.
    expect(launchMock.mock.calls[0][0].executablePath).toBeUndefined();
    expect(launchMock.mock.calls[1][0].executablePath).toBe(CACHED_PATH);
    expect(handle).toBeTruthy();

    // A browser.fallback NDJSON must announce which alternate was chosen.
    const fb = ndjson().find((e) => e.event === 'browser.fallback');
    expect(fb).toBeTruthy();
    expect(fb.to).toContain('1234');
  });

  it('(a2) tries a system channel when no cached build works', async () => {
    launchMock
      .mockRejectedValueOnce(missingBuildError()) // default pinned build
      .mockResolvedValueOnce({ browser: { close: vi.fn() }, context: null, close: vi.fn() });

    fallbackCandidatesMock.mockReturnValue([
      { source: 'system-channel', channel: 'chrome' },
    ]);

    const handle = await resolve({}, {});
    expect(launchMock.mock.calls[1][0].channel).toBe('chrome');
    expect(handle).toBeTruthy();
  });

  it('(b) pinned missing + nothing available → actionable error naming install cmd', async () => {
    launchMock.mockRejectedValue(missingBuildError());
    fallbackCandidatesMock.mockReturnValue([]); // no cached, no system chromium

    await expect(resolve({}, {})).rejects.toThrow(/npx playwright install chromium/);
    // The original launch is attempted exactly once (no viable fallback).
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('(b2) fallback candidate also missing → still ends in actionable error', async () => {
    // Both the default AND the single cached candidate fail to launch.
    launchMock
      .mockRejectedValueOnce(missingBuildError())
      .mockRejectedValueOnce(missingBuildError());
    fallbackCandidatesMock.mockReturnValue([
      { source: 'ms-playwright-cache', executablePath: CACHED_PATH, revision: 1234 },
    ]);

    await expect(resolve({}, {})).rejects.toThrow(/npx playwright install chromium/);
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('(c) hard override BROWSER_EXECUTABLE_PATH failure is surfaced, not masked', async () => {
    // An explicit exec path that fails must propagate verbatim — the pinned
    // fallback must NOT second-guess an explicit user choice.
    launchMock.mockRejectedValue(new Error('spawn /opt/custom/chrome ENOENT'));

    await expect(
      resolve({ BROWSER_EXECUTABLE_PATH: '/opt/custom/chrome' }, {}),
    ).rejects.toThrow(/ENOENT/);

    // No fallback attempt: exactly one launch, and the fallback enumerator is
    // never consulted for an explicit exec-path override.
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(fallbackCandidatesMock).not.toHaveBeenCalled();
  });

  it('(c2) explicit native channel failure is surfaced, not masked by fallback', async () => {
    // BROWSER_CHANNEL=chrome is an explicit choice; a launch failure there
    // propagates without a silent switch to a different browser.
    launchMock.mockRejectedValue(new Error('chrome channel not installed'));

    await expect(
      resolve({ BROWSER_CHANNEL: 'chrome' }, {}),
    ).rejects.toThrow(/chrome channel not installed/);

    expect(fallbackCandidatesMock).not.toHaveBeenCalled();
  });
});
