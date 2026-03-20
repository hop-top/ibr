/**
 * Unit tests for src/daemon.js
 * Covers: readState, isProcessAlive, healthCheck, startServer, ensureServer, sendCommand
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── module mocks ─────────────────────────────────────────────────────────────

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { readFile } from 'fs/promises';
import { spawn } from 'child_process';

import {
  readState,
  isProcessAlive,
  healthCheck,
  startServer,
  ensureServer,
  sendCommand,
} from '../../src/daemon.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides = {}) {
  return { pid: 1234, port: 51234, token: 'test-token-uuid', startedAt: Date.now(), ...overrides };
}

// ── readState ─────────────────────────────────────────────────────────────────

describe('readState', () => {
  it('returns parsed state when file is valid JSON', async () => {
    const state = makeState();
    readFile.mockResolvedValueOnce(JSON.stringify(state));

    const result = await readState();

    expect(result).toEqual(state);
  });

  it('returns null when file does not exist', async () => {
    readFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await readState();

    expect(result).toBeNull();
  });

  it('returns null when file contains invalid JSON', async () => {
    readFile.mockResolvedValueOnce('not-valid-json{{{');

    const result = await readState();

    expect(result).toBeNull();
  });
});

// ── isProcessAlive ────────────────────────────────────────────────────────────

describe('isProcessAlive', () => {
  it('returns true when process exists', () => {
    vi.spyOn(process, 'kill').mockImplementationOnce(() => true);

    expect(isProcessAlive(1234)).toBe(true);
  });

  it('returns false when process does not exist (ESRCH)', () => {
    vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });

    expect(isProcessAlive(9999)).toBe(false);
  });

  it('returns true when process exists but no permission (EPERM)', () => {
    vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });

    expect(isProcessAlive(1234)).toBe(true);
  });

  it('passes signal 0 to process.kill', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementationOnce(() => true);

    isProcessAlive(1234);

    expect(killSpy).toHaveBeenCalledWith(1234, 0);
  });
});

// ── healthCheck ───────────────────────────────────────────────────────────────

describe('healthCheck', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when /health responds ok', async () => {
    fetch.mockResolvedValueOnce({ ok: true });

    const result = await healthCheck(51234, 'any-token');

    expect(result).toBe(true);
  });

  it('returns false when /health responds not-ok', async () => {
    fetch.mockResolvedValueOnce({ ok: false });

    const result = await healthCheck(51234, 'any-token');

    expect(result).toBe(false);
  });

  it('returns false when fetch throws (connection refused)', async () => {
    fetch.mockRejectedValueOnce(Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    const result = await healthCheck(51234, 'any-token');

    expect(result).toBe(false);
  });

  it('calls the correct localhost URL', async () => {
    fetch.mockResolvedValueOnce({ ok: true });

    await healthCheck(51234, 'any-token');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:51234/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});

// ── startServer ───────────────────────────────────────────────────────────────

describe('startServer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    const fakeChild = { unref: vi.fn() };
    spawn.mockReturnValue(fakeChild);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('spawns node with server.js detached', async () => {
    // Server becomes healthy on first poll
    readFile
      .mockRejectedValueOnce(new Error('ENOENT'))  // first poll — no file yet
      .mockResolvedValueOnce(JSON.stringify(makeState({ port: 51234, token: 'tok' })));
    fetch.mockResolvedValueOnce({ ok: true });

    await startServer();

    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([expect.stringContaining('server.js')]),
      expect.objectContaining({ detached: true })
    );
  });

  it('calls unref on spawned child', async () => {
    const fakeChild = { unref: vi.fn() };
    spawn.mockReturnValue(fakeChild);
    readFile.mockResolvedValueOnce(JSON.stringify(makeState({ port: 51235, token: 'tok2' })));
    fetch.mockResolvedValueOnce({ ok: true });

    await startServer();

    expect(fakeChild.unref).toHaveBeenCalled();
  });

  it('returns port and token from state file once server is healthy', async () => {
    readFile.mockResolvedValueOnce(JSON.stringify(makeState({ port: 51236, token: 'my-tok' })));
    fetch.mockResolvedValueOnce({ ok: true });

    const { port, token } = await startServer();

    expect(port).toBe(51236);
    expect(token).toBe('my-tok');
  });
});

// ── ensureServer ──────────────────────────────────────────────────────────────

describe('ensureServer', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.clearAllMocks();
    spawn.mockReturnValue({ unref: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reuses existing server when process alive and health ok', async () => {
    const state = makeState({ pid: process.pid }); // current process is always alive
    readFile.mockResolvedValueOnce(JSON.stringify(state));
    vi.spyOn(process, 'kill').mockReturnValueOnce(true); // signal 0 succeeds
    fetch.mockResolvedValueOnce({ ok: true }); // health check passes

    const result = await ensureServer();

    expect(result).toEqual({ port: state.port, token: state.token });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts fresh server when state file missing', async () => {
    readFile
      .mockRejectedValueOnce(new Error('ENOENT'))           // ensureServer readState
      .mockResolvedValueOnce(JSON.stringify(makeState({ port: 51237, token: 'new' }))); // startServer poll
    fetch.mockResolvedValueOnce({ ok: true });

    const result = await ensureServer();

    expect(spawn).toHaveBeenCalled();
    expect(result.port).toBe(51237);
  });

  it('starts fresh server when recorded pid is dead', async () => {
    const state = makeState({ pid: 99999999 }); // very unlikely to be a real pid
    vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });
    readFile
      .mockResolvedValueOnce(JSON.stringify(state))           // ensureServer readState
      .mockResolvedValueOnce(JSON.stringify(makeState({ port: 51238, token: 'fresh' }))); // startServer poll
    fetch.mockResolvedValueOnce({ ok: true });

    const result = await ensureServer();

    expect(spawn).toHaveBeenCalled();
    expect(result.port).toBe(51238);
  });

  it('starts fresh server when health check fails', async () => {
    const state = makeState({ pid: process.pid });
    vi.spyOn(process, 'kill').mockImplementationOnce(() => true); // alive
    readFile
      .mockResolvedValueOnce(JSON.stringify(state))  // ensureServer readState
      .mockResolvedValueOnce(JSON.stringify(makeState({ port: 51239, token: 'revived' }))); // startServer poll
    fetch
      .mockResolvedValueOnce({ ok: false })           // health fails
      .mockResolvedValueOnce({ ok: true });           // health ok after restart

    const result = await ensureServer();

    expect(spawn).toHaveBeenCalled();
    expect(result.port).toBe(51239);
  });
});

// ── sendCommand ───────────────────────────────────────────────────────────────

describe('sendCommand', () => {
  let originalExit;
  let originalStdout;
  let originalStderr;
  let stdoutOutput;
  let stderrOutput;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    originalExit = process.exit;
    originalStdout = process.stdout.write.bind(process.stdout);
    originalStderr = process.stderr.write.bind(process.stderr);
    stdoutOutput = [];
    stderrOutput = [];
    process.exit = vi.fn();
    vi.spyOn(process.stdout, 'write').mockImplementation(data => { stdoutOutput.push(data); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation(data => { stderrOutput.push(data); return true; });
    spawn.mockReturnValue({ unref: vi.fn() });
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('writes response text to stdout and calls exit(0) on success', async () => {
    fetch.mockResolvedValueOnce({ ok: true, text: async () => '{"extracts":[]}' });

    await sendCommand('do something', 51234, 'tok');

    expect(stdoutOutput.join('')).toContain('{"extracts":[]}');
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('writes error to stderr and calls exit(1) on non-ok response', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'Task failed', hint: 'try again' }),
    });

    await sendCommand('do something', 51234, 'tok');

    expect(stderrOutput.join('')).toContain('Task failed');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('sends POST /command with Bearer token and prompt', async () => {
    fetch.mockResolvedValueOnce({ ok: true, text: async () => 'ok' });

    await sendCommand('my prompt', 51234, 'secret-tok');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:51234/command',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-tok' }),
        body: expect.stringContaining('my prompt'),
      })
    );
  });

  it('retries once on ECONNREFUSED by restarting server', async () => {
    const connErr = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    // First call: connection refused; then ensureServer + retry succeeds
    fetch
      .mockRejectedValueOnce(connErr)                                        // initial attempt fails
      .mockResolvedValueOnce({ ok: true })                                   // health check in ensureServer
      .mockResolvedValueOnce({ ok: true, text: async () => 'retried' });    // retry attempt

    readFile.mockResolvedValue(JSON.stringify(makeState({ port: 51234, token: 'tok' })));
    vi.spyOn(process, 'kill').mockReturnValue(true);

    await sendCommand('prompt', 51234, 'tok');

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(stdoutOutput.join('')).toContain('retried');
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('calls exit(1) on AbortError (timeout)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    fetch.mockRejectedValueOnce(abortErr);
    // Make exit throw so execution doesn't continue past the abort handling
    process.exit.mockImplementationOnce((code) => { throw Object.assign(new Error(`process.exit(${code})`), { _exitCode: code }); });

    await expect(sendCommand('slow prompt', 51234, 'tok')).rejects.toMatchObject({ _exitCode: 1 });

    expect(stderrOutput.join('')).toContain('timed out');
  });
});
