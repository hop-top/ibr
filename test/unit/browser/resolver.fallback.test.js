/**
 * Tests for resolver.js [SECTION: CAPABILITY] (T-0031).
 *
 * Covers:
 *   - lightpanda launch failure + BROWSER_FALLBACK → fallback channel used
 *   - fallback success records via recordBroken (manifest spy)
 *   - fallback success emits capability.learned + browser.fallback NDJSON
 *   - fallback failure: propagates fallback's error, does NOT record
 *   - no BROWSER_FALLBACK: original error propagates, no retry
 *   - non-lightpanda channel failure: no fallback attempted
 *   - BROWSER_STRICT=true with prior launch entry refuses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';

const launchMock = vi.fn();
const connectMock = vi.fn();
const spawnMock = vi.fn();

const recordBrokenMock = vi.fn();
const isKnownBrokenMock = vi.fn();

vi.mock('../../../src/browser/launchers/playwright-launch.js', () => ({
  launch: (...args) => launchMock(...args),
}));

vi.mock('../../../src/browser/launchers/playwright-connect.js', () => ({
  connect: (...args) => connectMock(...args),
}));

vi.mock('../../../src/browser/launchers/lightpanda-spawner.js', () => ({
  spawn: (...args) => spawnMock(...args),
}));

vi.mock('../../../src/browser/capability-manifest.js', async () => {
  const actual = await vi.importActual('../../../src/browser/capability-manifest.js');
  return {
    ...actual,
    recordBroken: (...args) => recordBrokenMock(...args),
    isKnownBroken: (...args) => isKnownBrokenMock(...args),
  };
});

import { resolve } from '../../../src/browser/resolver.js';

let stderrSpy;
let existsSpy;
let platformSpy;

beforeEach(() => {
  launchMock.mockReset();
  connectMock.mockReset();
  spawnMock.mockReset();
  recordBrokenMock.mockReset().mockResolvedValue({});
  isKnownBrokenMock.mockReset().mockResolvedValue(null);

  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  existsSpy = vi.spyOn(fs, 'existsSync');
  // Force darwin so the fs.existsSync mocks (which assert macOS paths
  // like /opt/homebrew/bin/*) behave identically on any CI host.
  platformSpy = vi.spyOn(os, 'platform').mockReturnValue('darwin');
});

afterEach(() => {
  stderrSpy.mockRestore();
  existsSpy.mockRestore();
  platformSpy.mockRestore();
});

function ndjsonLines() {
  return stderrSpy.mock.calls
    .map((c) => c[0])
    .filter((s) => typeof s === 'string')
    .flatMap((s) => s.split('\n').filter(Boolean))
    .map((s) => {
      try { return JSON.parse(s); } catch { return null; }
    })
    .filter(Boolean);
}

describe('resolver capability — fallback wrapper', () => {
  it('lightpanda launch failure + BROWSER_FALLBACK → fallback resolves', async () => {
    // First call: lightpanda probe hits, spawn throws.
    existsSpy.mockImplementation(
      (p) => p === '/opt/homebrew/bin/lightpanda' || p === '/opt/homebrew/bin/chromium',
    );
    spawnMock.mockRejectedValue(new Error('spawn failed: lightpanda crashed'));

    // Second call: fallback chromium-launch succeeds.
    launchMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: null,
      close: vi.fn(),
    });

    const handle = await resolve(
      { BROWSER_CHANNEL: 'lightpanda', BROWSER_FALLBACK: 'chromium' },
      {},
    );

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(launchMock).toHaveBeenCalledOnce();
    expect(handle.ownership).toBe('launch');
  });

  it('fallback success records launch failure in manifest', async () => {
    existsSpy.mockImplementation(
      (p) => p === '/opt/homebrew/bin/lightpanda' || p === '/opt/homebrew/bin/chromium',
    );
    spawnMock.mockRejectedValue(new Error('boom 12345 https://x.test/y'));
    launchMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: null,
      close: vi.fn(),
    });

    await resolve(
      { BROWSER_CHANNEL: 'lightpanda', BROWSER_FALLBACK: 'chromium' },
      {},
    );

    expect(recordBrokenMock).toHaveBeenCalledOnce();
    const [key, rec] = recordBrokenMock.mock.calls[0];
    expect(typeof key).toBe('string');
    expect(key).toMatch(/^unknown\|/);
    expect(rec.opKind).toBe('launch');
    expect(rec.signature).toMatch(/^sha256:/);
    expect(rec.fallbackSucceededOn).toBe('chromium');
    // fingerprint should have stripped URLs and numbers
    expect(rec.errorFingerprint).not.toMatch(/https?:/);
    expect(rec.errorFingerprint).not.toMatch(/12345/);
  });

  it('fallback success emits capability.learned + browser.fallback NDJSON', async () => {
    existsSpy.mockImplementation(
      (p) => p === '/opt/homebrew/bin/lightpanda' || p === '/opt/homebrew/bin/chromium',
    );
    spawnMock.mockRejectedValue(new Error('connect refused'));
    launchMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: null,
      close: vi.fn(),
    });

    await resolve(
      { BROWSER_CHANNEL: 'lightpanda', BROWSER_FALLBACK: 'chromium' },
      {},
    );

    const evts = ndjsonLines();
    const learned = evts.find((e) => e.event === 'capability.learned');
    const fallback = evts.find((e) => e.event === 'browser.fallback');
    expect(learned).toBeTruthy();
    expect(learned.channel).toBe('lightpanda');
    expect(learned.fallback).toBe('chromium');
    expect(learned.opKind).toBe('launch');
    expect(fallback).toBeTruthy();
    expect(fallback.from).toBe('lightpanda');
    expect(fallback.to).toBe('chromium');
  });

  it('fallback failure propagates fallback error and does NOT record', async () => {
    existsSpy.mockImplementation(
      (p) => p === '/opt/homebrew/bin/lightpanda' || p === '/opt/homebrew/bin/chromium',
    );
    spawnMock.mockRejectedValue(new Error('lightpanda boom'));
    launchMock.mockRejectedValue(new Error('chromium also boom'));

    await expect(
      resolve(
        { BROWSER_CHANNEL: 'lightpanda', BROWSER_FALLBACK: 'chromium' },
        {},
      ),
    ).rejects.toThrow(/chromium also boom/);

    expect(recordBrokenMock).not.toHaveBeenCalled();
  });

  it('no BROWSER_FALLBACK: original error propagated, no retry', async () => {
    existsSpy.mockImplementation((p) => p === '/opt/homebrew/bin/lightpanda');
    spawnMock.mockRejectedValue(new Error('only-failure'));

    await expect(
      resolve({ BROWSER_CHANNEL: 'lightpanda' }, {}),
    ).rejects.toThrow(/only-failure/);

    expect(launchMock).not.toHaveBeenCalled();
    expect(recordBrokenMock).not.toHaveBeenCalled();
  });

  it('non-lightpanda channel failure: no fallback attempted', async () => {
    launchMock.mockRejectedValue(new Error('exec-path bad'));

    await expect(
      resolve(
        { BROWSER_EXECUTABLE_PATH: '/opt/brave', BROWSER_FALLBACK: 'chromium' },
        {},
      ),
    ).rejects.toThrow(/exec-path bad/);

    // Only one launch attempt — no retry on the fallback.
    expect(launchMock).toHaveBeenCalledOnce();
    expect(recordBrokenMock).not.toHaveBeenCalled();
  });

  it('BROWSER_STRICT=true refuses when prior launch entry exists', async () => {
    isKnownBrokenMock.mockResolvedValue({
      signature: 'sha256:launch',
      opKind: 'launch',
      observedCount: 4,
      lastSeen: '2026-04-01T00:00:00.000Z',
    });

    await expect(
      resolve(
        { BROWSER_CHANNEL: 'lightpanda', BROWSER_STRICT: 'true' },
        {},
      ),
    ).rejects.toThrow(/known-broken/);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  });

  it('BROWSER_STRICT=true with no prior entry proceeds normally', async () => {
    existsSpy.mockImplementation((p) => p === '/opt/homebrew/bin/lightpanda');
    spawnMock.mockResolvedValue({
      wsEndpoint: 'ws://127.0.0.1:1234',
      kill: vi.fn(),
      proc: { pid: 1 },
      pid: 1,
      ringBuffer: { tail: () => '' },
      startupMs: 1,
    });
    connectMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: null,
      close: vi.fn(),
    });

    const handle = await resolve(
      { BROWSER_CHANNEL: 'lightpanda', BROWSER_STRICT: 'true' },
      {},
    );
    expect(handle.ownership).toBe('spawn-ibr');
  });
});
