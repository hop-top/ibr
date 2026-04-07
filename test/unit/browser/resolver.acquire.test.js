/**
 * Cache/download wiring tests for resolver.js (T-0030).
 *
 * Verifies that when local probe misses for a downloadable cdp-server entry,
 * resolver delegates to acquirer.acquire() and then dispatches via the
 * lightpanda spawn → connect path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';

const launchMock = vi.fn();
const connectMock = vi.fn();
const spawnMock = vi.fn();
const acquireMock = vi.fn();

vi.mock('../../../src/browser/launchers/playwright-launch.js', () => ({
  launch: (...args) => launchMock(...args),
}));

vi.mock('../../../src/browser/launchers/playwright-connect.js', () => ({
  connect: (...args) => connectMock(...args),
}));

vi.mock('../../../src/browser/launchers/lightpanda-spawner.js', () => ({
  spawn: (...args) => spawnMock(...args),
}));

vi.mock('../../../src/browser/acquirer.js', () => ({
  acquire: (...args) => acquireMock(...args),
}));

import { resolve } from '../../../src/browser/resolver.js';

let stderrSpy;
let existsSpy;

beforeEach(() => {
  launchMock.mockReset();
  connectMock.mockReset();
  spawnMock.mockReset();
  acquireMock.mockReset();
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false); // probe miss
});

afterEach(() => {
  stderrSpy.mockRestore();
  existsSpy.mockRestore();
});

describe('resolve — acquirer chain (cdp-server downloadable)', () => {
  it('probe miss for lightpanda → acquirer.acquire → spawn with cached path', async () => {
    acquireMock.mockResolvedValue({
      executablePath: '/cache/lightpanda/v1.2.3/lightpanda',
      source: 'cache',
      version: 'v1.2.3',
    });
    spawnMock.mockResolvedValue({
      wsEndpoint: 'ws://127.0.0.1:33333',
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

    const handle = await resolve({ BROWSER_CHANNEL: 'lightpanda' }, {});

    expect(acquireMock).toHaveBeenCalledOnce();
    const [entryArg, optsArg] = acquireMock.mock.calls[0];
    expect(entryArg.id).toBe('lightpanda');
    expect(optsArg).toEqual({ env: { BROWSER_CHANNEL: 'lightpanda' } });

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0][0].binPath).toBe(
      '/cache/lightpanda/v1.2.3/lightpanda',
    );

    expect(handle.ownership).toBe('spawn-ibr');

    // browser.resolved event should reflect the acquirer source/version.
    const lines = stderrSpy.mock.calls
      .map((c) => c[0])
      .filter((s) => typeof s === 'string')
      .flatMap((s) => s.split('\n').filter(Boolean))
      .map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);
    const resolved = lines.find((e) => e.event === 'browser.resolved');
    expect(resolved).toBeTruthy();
    expect(resolved.kind).toBe('cdp-server');
    expect(resolved.source).toBe('cache');
    expect(resolved.version).toBe('v1.2.3');
    expect(resolved.executablePath).toBe('/cache/lightpanda/v1.2.3/lightpanda');
  });

  it('acquirer throw → resolver surfaces error with context', async () => {
    acquireMock.mockRejectedValue(new Error('network unreachable'));

    await expect(
      resolve({ BROWSER_CHANNEL: 'lightpanda' }, {}),
    ).rejects.toThrow(/lightpanda.*network unreachable/);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });
});
