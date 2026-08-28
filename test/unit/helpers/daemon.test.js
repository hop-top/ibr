/**
 * Unit tests for test/helpers/daemon.js — the shared e2e daemon spawn/reap
 * helper. Covers the reap-on-throw contract: a health-poll timeout must not
 * orphan the just-spawned detached process.
 *
 * No real browser or real server.js process involved — child_process.spawn
 * and process.kill are mocked so this runs fast and without Chromium.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFileSync: vi.fn() };
});

const { spawn } = await import('node:child_process');
const { readFileSync } = await import('node:fs');
const { startDaemon, stopDaemon } = await import('../../helpers/daemon.js');

function makeFakeChild(pid = 4242) {
  return {
    pid,
    unref: vi.fn(),
    kill: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
  };
}

describe('startDaemon — reap on health-poll timeout', () => {
  let killSpy;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('kills the spawned process group when the health poll never succeeds', async () => {
    const fakeChild = makeFakeChild(5150);
    spawn.mockReturnValue(fakeChild);
    // State file never appears -> readStateFile always returns null -> poll times out.
    readFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });

    await expect(
      startDaemon('/tmp/does-not-matter.json', {}, { pollTimeoutMs: 50, pollIntervalMs: 10 })
    ).rejects.toThrow(/did not start/i);

    // The raw child must have been captured and reaped — process GROUP kill
    // (negative pid) so detached child browsers die too.
    expect(killSpy).toHaveBeenCalledWith(-5150, 'SIGTERM');
  });

  it('does not throw if the process group is already gone (ESRCH) while reaping', async () => {
    const fakeChild = makeFakeChild(6161);
    spawn.mockReturnValue(fakeChild);
    readFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    killSpy.mockImplementation(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); });

    await expect(
      startDaemon('/tmp/does-not-matter-2.json', {}, { pollTimeoutMs: 50, pollIntervalMs: 10 })
    ).rejects.toThrow(/did not start/i);

    // Must not surface the ESRCH from the reap attempt as an unhandled rejection
    // or mask the original timeout error — assertion above already proves that.
    expect(killSpy).toHaveBeenCalledWith(-6161, 'SIGTERM');
  });

  it('resolves with daemon state and does NOT kill when the poll succeeds', async () => {
    const fakeChild = makeFakeChild(7171);
    spawn.mockReturnValue(fakeChild);
    const state = { pid: 7171, port: 51234, token: 'tok' };
    readFileSync.mockReturnValue(JSON.stringify(state));
    fetch.mockResolvedValue({ ok: true });

    const result = await startDaemon('/tmp/does-not-matter-3.json', {}, { pollTimeoutMs: 200, pollIntervalMs: 10 });

    expect(result).toMatchObject(state);
    expect(result.child).toBe(fakeChild);
    expect(killSpy).not.toHaveBeenCalled();
  });
});

describe('stopDaemon — process-group kill via raw handle', () => {
  beforeEach(() => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('kills the process group using the raw pid, not a resolved daemonState', () => {
    stopDaemon({ pid: 8181 });

    expect(process.kill).toHaveBeenCalledWith(-8181, 'SIGTERM');
  });

  it('is a silent no-op when pid is already dead (ESRCH)', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); });

    expect(() => stopDaemon({ pid: 9191 })).not.toThrow();
  });

  it('is a silent no-op when handle is null/undefined (never spawned)', () => {
    expect(() => stopDaemon(null)).not.toThrow();
    expect(() => stopDaemon(undefined)).not.toThrow();
  });
});
