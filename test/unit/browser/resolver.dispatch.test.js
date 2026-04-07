/**
 * Lifecycle dispatch tests for resolver.js (T-0030).
 *
 * Covers:
 *   - chain step 2 (BROWSER_CDP_URL / LIGHTPANDA_WS) connect-only
 *   - LIGHTPANDA_WS deprecation NDJSON emission
 *   - BROWSER_EXECUTABLE_PATH + BROWSER_CHANNEL=lightpanda special case
 *   - cdp-server ibr-owned spawn happy path (close kills child)
 *   - cdp-server connect failure → spawnHandle.kill called, error propagated
 *   - chromium-launch dispatch ownership tag (regression)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

const launchMock = vi.fn();
const connectMock = vi.fn();
const spawnMock = vi.fn();

vi.mock('../../../src/browser/launchers/playwright-launch.js', () => ({
  launch: (...args) => launchMock(...args),
}));

vi.mock('../../../src/browser/launchers/playwright-connect.js', () => ({
  connect: (...args) => connectMock(...args),
}));

vi.mock('../../../src/browser/launchers/lightpanda-spawner.js', () => ({
  spawn: (...args) => spawnMock(...args),
}));

import { resolve } from '../../../src/browser/resolver.js';

let stderrSpy;

beforeEach(() => {
  launchMock.mockReset();
  connectMock.mockReset();
  spawnMock.mockReset();

  launchMock.mockResolvedValue({
    browser: { close: vi.fn() },
    context: null,
    close: vi.fn(),
  });

  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
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

// ── chromium-launch ownership tag (regression) ───────────────────────────────
describe('dispatch — chromium-launch', () => {
  it('tags handle with ownership=launch', async () => {
    const handle = await resolve({ BROWSER_EXECUTABLE_PATH: '/opt/brave' }, {});
    expect(launchMock).toHaveBeenCalledOnce();
    expect(handle.ownership).toBe('launch');
  });
});

// ── connect-only via BROWSER_CDP_URL ─────────────────────────────────────────
describe('dispatch — cdp-server connect-only (BROWSER_CDP_URL)', () => {
  it('calls playwright-connect.connect with the URL and tags ownership', async () => {
    const closeFn = vi.fn();
    connectMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: { id: 'ctx' },
      close: closeFn,
    });

    const handle = await resolve(
      { BROWSER_CDP_URL: 'ws://127.0.0.1:9222' },
      { viewport: { width: 800, height: 600 } },
    );

    expect(connectMock).toHaveBeenCalledOnce();
    expect(connectMock).toHaveBeenCalledWith({
      wsEndpoint: 'ws://127.0.0.1:9222',
      contextOptions: { viewport: { width: 800, height: 600 } },
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(handle.ownership).toBe('connect-user');

    // close() must NOT kill anything (no spawnHandle in connect-only mode)
    await handle.close();
    expect(closeFn).toHaveBeenCalledOnce();

    const evts = ndjsonLines();
    const resolved = evts.find((e) => e.event === 'browser.resolved');
    expect(resolved).toBeTruthy();
    expect(resolved.kind).toBe('cdp-server');
    expect(resolved.source).toBe('cdp-url');
    expect(resolved.wsEndpoint).toBe('ws://127.0.0.1:9222');
  });

  it('LIGHTPANDA_WS alone emits deprecation event and connects', async () => {
    connectMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: null,
      close: vi.fn(),
    });

    await resolve({ LIGHTPANDA_WS: 'ws://127.0.0.1:9333' }, {});

    expect(connectMock).toHaveBeenCalledWith({
      wsEndpoint: 'ws://127.0.0.1:9333',
      contextOptions: {},
    });

    const evts = ndjsonLines();
    const dep = evts.find((e) => e.event === 'browser.deprecation');
    expect(dep).toEqual({
      event: 'browser.deprecation',
      env: 'LIGHTPANDA_WS',
      use: 'BROWSER_CDP_URL',
    });
  });

  it('BROWSER_CDP_URL wins over LIGHTPANDA_WS, no deprecation emitted', async () => {
    connectMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: null,
      close: vi.fn(),
    });

    await resolve(
      {
        BROWSER_CDP_URL: 'ws://127.0.0.1:1111',
        LIGHTPANDA_WS: 'ws://127.0.0.1:2222',
      },
      {},
    );

    expect(connectMock).toHaveBeenCalledWith({
      wsEndpoint: 'ws://127.0.0.1:1111',
      contextOptions: {},
    });
    const evts = ndjsonLines();
    expect(evts.find((e) => e.event === 'browser.deprecation')).toBeUndefined();
  });
});

// ── BROWSER_EXECUTABLE_PATH + BROWSER_CHANNEL=lightpanda → ibr-owned spawn ──
describe('dispatch — exec-path with channel=lightpanda', () => {
  it('treats exec-path as a lightpanda spawn target (cdp-server)', async () => {
    spawnMock.mockResolvedValue({
      wsEndpoint: 'ws://127.0.0.1:55555',
      kill: vi.fn(),
      proc: { pid: 99 },
      pid: 99,
      ringBuffer: { tail: () => '' },
      startupMs: 5,
    });
    const closeFn = vi.fn();
    connectMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: null,
      close: closeFn,
    });

    const handle = await resolve(
      {
        BROWSER_EXECUTABLE_PATH: '/opt/lightpanda',
        BROWSER_CHANNEL: 'lightpanda',
      },
      {},
    );

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0][0].binPath).toBe('/opt/lightpanda');
    expect(connectMock).toHaveBeenCalledWith({
      wsEndpoint: 'ws://127.0.0.1:55555',
      contextOptions: {},
    });
    expect(handle.ownership).toBe('spawn-ibr');
    expect(handle.spawnHandle).toBeTruthy();
  });
});

// ── ibr-owned spawn via local probe hit ──────────────────────────────────────
describe('dispatch — cdp-server ibr-owned spawn (probe hit)', () => {
  let existsSpy;

  beforeEach(() => {
    existsSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    existsSpy.mockRestore();
  });

  it('probe → spawn → connect; close() invokes both close + kill', async () => {
    // Make ONE of the probe paths match.
    existsSpy.mockImplementation((p) => p === '/opt/homebrew/bin/lightpanda');

    const killFn = vi.fn();
    spawnMock.mockResolvedValue({
      wsEndpoint: 'ws://127.0.0.1:44444',
      kill: killFn,
      proc: { pid: 12 },
      pid: 12,
      ringBuffer: { tail: () => '' },
      startupMs: 10,
    });
    const connectedClose = vi.fn();
    connectMock.mockResolvedValue({
      browser: { close: vi.fn() },
      context: null,
      close: connectedClose,
    });

    const handle = await resolve(
      { BROWSER_CHANNEL: 'lightpanda', OBEY_ROBOTS: 'true' },
      { ignoreHTTPSErrors: true },
    );

    expect(spawnMock).toHaveBeenCalledOnce();
    const spawnArgs = spawnMock.mock.calls[0][0];
    expect(spawnArgs.binPath).toBe('/opt/homebrew/bin/lightpanda');
    expect(spawnArgs.obeyRobots).toBe(true);

    expect(connectMock).toHaveBeenCalledWith({
      wsEndpoint: 'ws://127.0.0.1:44444',
      contextOptions: { ignoreHTTPSErrors: true },
    });

    expect(handle.ownership).toBe('spawn-ibr');
    expect(handle.spawnHandle).toBeTruthy();

    await handle.close();
    expect(connectedClose).toHaveBeenCalledOnce();
    expect(killFn).toHaveBeenCalledOnce();
  });

  it('connect failure after spawn calls spawnHandle.kill and propagates error', async () => {
    existsSpy.mockImplementation((p) => p === '/opt/homebrew/bin/lightpanda');

    const killFn = vi.fn();
    spawnMock.mockResolvedValue({
      wsEndpoint: 'ws://127.0.0.1:44444',
      kill: killFn,
      proc: { pid: 13 },
      pid: 13,
      ringBuffer: { tail: () => '' },
      startupMs: 10,
    });
    connectMock.mockRejectedValue(new Error('handshake failed'));

    await expect(
      resolve({ BROWSER_CHANNEL: 'lightpanda' }, {}),
    ).rejects.toThrow(/handshake failed/);

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(killFn).toHaveBeenCalledOnce();
  });
});
