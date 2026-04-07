import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  spawn,
  _findFreePort,
  _waitForCdpReady,
  _createRingBuffer
} from '../../../../src/browser/launchers/lightpanda-spawner.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a fake ChildProcess: stdout/stderr are EventEmitters; emits exit
 * via .once('exit', ...). pid is fixed unless overridden.
 */
function makeFakeProc({ pid = 12345 } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = pid;
  proc.kill = vi.fn();
  return proc;
}

/**
 * Build a fake `http` module whose `.request()` invokes a user-provided
 * responder. The responder is called as `responder(opts, { ok, fail, refused })`
 * where:
 *   - ok(statusCode=200) — synthesizes a response and triggers the cb
 *   - fail(err) — emits 'error' on the request
 *   - refused() — emits ECONNREFUSED on the request
 */
function makeFakeHttp(responder) {
  let calls = 0;
  const fake = {
    calls: () => calls,
    request(opts, cb) {
      const req = new EventEmitter();
      req.end = vi.fn();
      req.destroy = vi.fn();
      const helpers = {
        ok(statusCode = 200) {
          const res = new EventEmitter();
          res.statusCode = statusCode;
          res.resume = vi.fn();
          // Defer to next tick to mimic real async behavior.
          setImmediate(() => cb(res));
        },
        fail(err) {
          setImmediate(() => req.emit('error', err));
        },
        refused() {
          const e = new Error('ECONNREFUSED');
          e.code = 'ECONNREFUSED';
          setImmediate(() => req.emit('error', e));
        }
      };
      calls += 1;
      try {
        responder(opts, helpers, calls);
      } catch (err) {
        setImmediate(() => req.emit('error', err));
      }
      return req;
    }
  };
  return fake;
}

// ─── _createRingBuffer ──────────────────────────────────────────────────────

describe('lightpanda-spawner / _createRingBuffer', () => {
  it('accepts writes under cap and returns full content via tail()', () => {
    const rb = _createRingBuffer(1024);
    rb.write(Buffer.from('hello '));
    rb.write(Buffer.from('world'));
    expect(rb.size()).toBe(11);
    expect(rb.tail()).toBe('hello world');
  });

  it('drops oldest bytes when total exceeds cap', () => {
    const rb = _createRingBuffer(8);
    rb.write(Buffer.from('AAAA'));
    rb.write(Buffer.from('BBBB'));
    rb.write(Buffer.from('CCCC')); // forces drop
    expect(rb.size()).toBe(8);
    expect(rb.tail()).toBe('BBBBCCCC');
  });

  it('slices the head chunk when overflow is partial', () => {
    const rb = _createRingBuffer(5);
    rb.write(Buffer.from('ABCDE'));
    rb.write(Buffer.from('FG'));
    expect(rb.size()).toBe(5);
    expect(rb.tail()).toBe('CDEFG');
  });

  it('tail(n) returns at most last n bytes', () => {
    const rb = _createRingBuffer(1024);
    rb.write(Buffer.from('abcdefghij'));
    expect(rb.tail(4)).toBe('ghij');
    expect(rb.tail(100)).toBe('abcdefghij');
  });

  it('handles string writes by coercing to Buffer', () => {
    const rb = _createRingBuffer(64);
    rb.write('hello');
    expect(rb.tail()).toBe('hello');
  });

  it('ignores empty/null writes', () => {
    const rb = _createRingBuffer(64);
    rb.write(null);
    rb.write('');
    expect(rb.size()).toBe(0);
    expect(rb.tail()).toBe('');
  });
});

// ─── _findFreePort ──────────────────────────────────────────────────────────

describe('lightpanda-spawner / _findFreePort', () => {
  it('returns a positive integer port', async () => {
    const p = await _findFreePort();
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(65536);
  });
});

// ─── _waitForCdpReady ───────────────────────────────────────────────────────

describe('lightpanda-spawner / _waitForCdpReady', () => {
  it('resolves when http returns 200 after a couple of refused polls', async () => {
    let n = 0;
    const fakeHttp = makeFakeHttp((_opts, h) => {
      n += 1;
      if (n < 3) h.refused();
      else h.ok(200);
    });
    await _waitForCdpReady({
      host: '127.0.0.1',
      port: 9999,
      timeoutMs: 2000,
      httpModule: fakeHttp
    });
    expect(n).toBe(3);
  });

  it('resolves immediately on first 200', async () => {
    const fakeHttp = makeFakeHttp((_opts, h) => h.ok(200));
    await _waitForCdpReady({
      host: '127.0.0.1',
      port: 9999,
      timeoutMs: 2000,
      httpModule: fakeHttp
    });
    expect(fakeHttp.calls()).toBe(1);
  });

  it('rejects with timeout when http always refuses', async () => {
    const fakeHttp = makeFakeHttp((_opts, h) => h.refused());
    await expect(
      _waitForCdpReady({
        host: '127.0.0.1',
        port: 9999,
        timeoutMs: 250,
        httpModule: fakeHttp
      })
    ).rejects.toThrow(/CDP ready timeout/);
  });

  it('rejects immediately on a non-200 status (not refused)', async () => {
    const fakeHttp = makeFakeHttp((_opts, h) => h.ok(500));
    await expect(
      _waitForCdpReady({
        host: '127.0.0.1',
        port: 9999,
        timeoutMs: 2000,
        httpModule: fakeHttp
      })
    ).rejects.toThrow(/unexpected status 500/);
  });

  it('rejects immediately on a non-refused-like error', async () => {
    const fakeHttp = makeFakeHttp((_opts, h) => {
      const e = new Error('boom');
      e.code = 'EACCES';
      h.fail(e);
    });
    await expect(
      _waitForCdpReady({
        host: '127.0.0.1',
        port: 9999,
        timeoutMs: 2000,
        httpModule: fakeHttp
      })
    ).rejects.toThrow(/boom/);
  });
});

// ─── spawn() ────────────────────────────────────────────────────────────────

describe('lightpanda-spawner / spawn()', () => {
  let stderrSpy;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    vi.useRealTimers();
  });

  function makeDeps({
    proc,
    httpResponder,
    findFreePort = async () => 51234,
    assertExecutable = () => {}
  }) {
    const spawnFn = vi.fn(() => proc);
    const httpModule = makeFakeHttp(httpResponder || ((_o, h) => h.ok(200)));
    return {
      _deps: { spawn: spawnFn, http: httpModule, findFreePort, assertExecutable },
      _spawnFn: spawnFn,
      _httpModule: httpModule
    };
  }

  it('happy path: returns wsEndpoint, pid, startupMs, ringBuffer; emits browser.spawned', async () => {
    const proc = makeFakeProc({ pid: 4242 });
    const { _deps, _spawnFn } = makeDeps({ proc });

    const promise = spawn({
      binPath: '/fake/lightpanda',
      host: '127.0.0.1',
      port: 51234,
      _deps
    });

    // Push some output before CDP ready resolves. Wait a tick so the
    // spawner has had a chance to attach its stdout/stderr listeners.
    await new Promise((r) => setImmediate(r));
    proc.stdout.emit('data', Buffer.from('boot line 1\n'));
    proc.stderr.emit('data', Buffer.from('boot line 2\n'));

    const handle = await promise;

    expect(_spawnFn).toHaveBeenCalledTimes(1);
    expect(handle.pid).toBe(4242);
    expect(handle.wsEndpoint).toBe('ws://127.0.0.1:51234');
    expect(typeof handle.startupMs).toBe('number');
    expect(handle.startupMs).toBeGreaterThanOrEqual(0);
    expect(handle.ringBuffer.tail()).toContain('boot line 1');
    expect(handle.ringBuffer.tail()).toContain('boot line 2');

    // Verify NDJSON browser.spawned emitted on stderr.
    const lines = stderrSpy.mock.calls.map((c) => c[0]);
    const evtLine = lines.find((l) => typeof l === 'string' && l.includes('browser.spawned'));
    expect(evtLine).toBeDefined();
    const parsed = JSON.parse(evtLine.trim());
    expect(parsed).toMatchObject({
      event: 'browser.spawned',
      channel: 'lightpanda',
      pid: 4242,
      wsEndpoint: 'ws://127.0.0.1:51234'
    });
    expect(typeof parsed.startupMs).toBe('number');
  });

  it('args include --host, --port, and serve subcommand', async () => {
    const proc = makeFakeProc();
    const { _deps, _spawnFn } = makeDeps({ proc });
    await spawn({ binPath: '/fake/lp', host: '0.0.0.0', port: 9333, _deps });
    const callArgs = _spawnFn.mock.calls[0];
    expect(callArgs[0]).toBe('/fake/lp');
    expect(callArgs[1]).toEqual(['serve', '--host', '0.0.0.0', '--port', '9333']);
  });

  it('args include --obey-robots when obeyRobots=true', async () => {
    const proc = makeFakeProc();
    const { _deps, _spawnFn } = makeDeps({ proc });
    await spawn({ binPath: '/fake/lp', port: 9333, obeyRobots: true, _deps });
    expect(_spawnFn.mock.calls[0][1]).toContain('--obey-robots');
  });

  it('args do NOT include --obey-robots when obeyRobots=false', async () => {
    const proc = makeFakeProc();
    const { _deps, _spawnFn } = makeDeps({ proc });
    await spawn({ binPath: '/fake/lp', port: 9333, obeyRobots: false, _deps });
    expect(_spawnFn.mock.calls[0][1]).not.toContain('--obey-robots');
  });

  it('child env has LIGHTPANDA_DISABLE_TELEMETRY=true by default', async () => {
    const proc = makeFakeProc();
    const { _deps, _spawnFn } = makeDeps({ proc });
    await spawn({ binPath: '/fake/lp', port: 9333, env: { FOO: 'bar' }, _deps });
    const opts = _spawnFn.mock.calls[0][2];
    expect(opts.env.LIGHTPANDA_DISABLE_TELEMETRY).toBe('true');
    expect(opts.env.FOO).toBe('bar');
  });

  it('user opt-in: LIGHTPANDA_TELEMETRY=true removes LIGHTPANDA_DISABLE_TELEMETRY', async () => {
    const proc = makeFakeProc();
    const { _deps, _spawnFn } = makeDeps({ proc });
    await spawn({
      binPath: '/fake/lp',
      port: 9333,
      env: { LIGHTPANDA_TELEMETRY: 'true' },
      _deps
    });
    const opts = _spawnFn.mock.calls[0][2];
    expect('LIGHTPANDA_DISABLE_TELEMETRY' in opts.env).toBe(false);
    expect(opts.env.LIGHTPANDA_TELEMETRY).toBe('true');
  });

  it('does not mutate caller env', async () => {
    const proc = makeFakeProc();
    const { _deps } = makeDeps({ proc });
    const callerEnv = { FOO: 'bar' };
    await spawn({ binPath: '/fake/lp', port: 9333, env: callerEnv, _deps });
    expect(callerEnv).toEqual({ FOO: 'bar' });
    expect('LIGHTPANDA_DISABLE_TELEMETRY' in callerEnv).toBe(false);
  });

  it('kill() sends SIGTERM and is idempotent', async () => {
    const proc = makeFakeProc();
    const { _deps } = makeDeps({ proc });
    const handle = await spawn({ binPath: '/fake/lp', port: 9333, _deps });
    handle.kill();
    handle.kill();
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('CDP ready timeout: kills child + throws with ringBuffer tail in error', async () => {
    const proc = makeFakeProc();
    const { _deps } = makeDeps({
      proc,
      // Always refused → forces timeout.
      httpResponder: (_o, h) => h.refused()
    });

    const promise = spawn({
      binPath: '/fake/lp',
      port: 9333,
      timeoutMs: 200,
      _deps
    });

    proc.stdout.emit('data', Buffer.from('startup chatter\n'));

    await expect(promise).rejects.toThrow(/CDP ready timeout/);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    // Re-throw should have ring buffer tail attached.
    try {
      await spawn({ binPath: '/fake/lp', port: 9333, timeoutMs: 100, _deps });
    } catch (err) {
      expect(err.message).toMatch(/--- tail ---/);
    }
  });

  it('child exits during startup before CDP ready: throws with code + tail', async () => {
    const proc = makeFakeProc();
    // http never resolves quickly: refuse forever; instead we trigger
    // an exit shortly after spawn.
    const { _deps } = makeDeps({
      proc,
      httpResponder: (_o, h) => h.refused()
    });

    const promise = spawn({
      binPath: '/fake/lp',
      port: 9333,
      timeoutMs: 5000,
      _deps
    });

    // Emit some output then exit nonzero.
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from('panic: unable to bind\n'));
      proc.emit('exit', 1, null);
    });

    await expect(promise).rejects.toThrow(/exited during startup/);
    // Tail should be present in the error message.
    try {
      const proc2 = makeFakeProc();
      const { _deps: deps2 } = makeDeps({
        proc: proc2,
        httpResponder: (_o, h) => h.refused()
      });
      const p2 = spawn({ binPath: '/fake/lp', port: 9333, _deps: deps2 });
      setImmediate(() => {
        proc2.stdout.emit('data', Buffer.from('panic xyz\n'));
        proc2.emit('exit', 2, null);
      });
      await p2;
    } catch (err) {
      expect(err.message).toMatch(/panic xyz/);
      expect(err.message).toMatch(/code=2/);
    }
  });

  it('emits browser.exited NDJSON on exit after successful startup', async () => {
    const proc = makeFakeProc({ pid: 7777 });
    const { _deps } = makeDeps({ proc });
    const handle = await spawn({ binPath: '/fake/lp', port: 9333, _deps });

    // Emit some output then exit normally.
    proc.stderr.emit('data', Buffer.from('shutting down\n'));
    proc.emit('exit', 0, null);

    // Find browser.exited line.
    const lines = stderrSpy.mock.calls.map((c) => c[0]);
    const evtLine = lines.find((l) => typeof l === 'string' && l.includes('browser.exited'));
    expect(evtLine).toBeDefined();
    const parsed = JSON.parse(evtLine.trim());
    expect(parsed).toMatchObject({
      event: 'browser.exited',
      channel: 'lightpanda',
      pid: 7777,
      code: 0,
      signal: null
    });
    expect(parsed.tail).toContain('shutting down');
    expect(handle.pid).toBe(7777);
  });

  it('port=0 calls findFreePort', async () => {
    const proc = makeFakeProc();
    const findFreePort = vi.fn(async () => 55555);
    const { _deps, _spawnFn } = makeDeps({ proc, findFreePort });
    const handle = await spawn({ binPath: '/fake/lp', port: 0, _deps });
    expect(findFreePort).toHaveBeenCalledTimes(1);
    expect(handle.wsEndpoint).toBe('ws://127.0.0.1:55555');
    expect(_spawnFn.mock.calls[0][1]).toContain('55555');
  });

  it('port>0 uses provided port (no findFreePort call)', async () => {
    const proc = makeFakeProc();
    const findFreePort = vi.fn(async () => 99999);
    const { _deps, _spawnFn } = makeDeps({ proc, findFreePort });
    const handle = await spawn({ binPath: '/fake/lp', port: 9222, _deps });
    expect(findFreePort).not.toHaveBeenCalled();
    expect(handle.wsEndpoint).toBe('ws://127.0.0.1:9222');
    expect(_spawnFn.mock.calls[0][1]).toContain('9222');
  });

  it('throws (without spawning) when binPath is missing', async () => {
    const proc = makeFakeProc();
    const { _deps, _spawnFn } = makeDeps({
      proc,
      assertExecutable: () => {
        throw new Error('binPath not found');
      }
    });
    await expect(spawn({ binPath: '/nope', port: 9333, _deps })).rejects.toThrow(
      /binPath not found/
    );
    expect(_spawnFn).not.toHaveBeenCalled();
  });
});
