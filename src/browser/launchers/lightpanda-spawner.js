/**
 * Lightpanda process spawner.
 *
 * Owns the lightpanda child process lifecycle for ibr-managed modes
 * (one-shot and daemon-owned). Connect-only mode (BROWSER_CDP_URL set)
 * does not use this.
 *
 * Responsibilities:
 *   - Allocate a free TCP port (with retry/backoff) when port=0
 *   - Build args + child env (passing through obeyRobots, telemetry opt-in)
 *   - Spawn lightpanda via child_process.spawn
 *   - Capture stdout+stderr in a 1MB ring buffer for crash diagnostics
 *   - Poll the CDP `/json/version` endpoint until ready (with timeout)
 *   - Emit NDJSON lifecycle events (`browser.spawned`, `browser.exited`)
 *   - Provide an idempotent `kill()` for callers
 *
 * Restart-on-crash is intentionally NOT handled here — that lives in the
 * server.js wiring (T-0030). The spawner only reports.
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0029
 */

import { spawn as cpSpawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';

// ─── NDJSON event emission ──────────────────────────────────────────────────

/**
 * Emit a single NDJSON line to stderr. Best-effort; never throws.
 *
 * @param {object} obj
 */
function emitEvent(obj) {
  try {
    process.stderr.write(JSON.stringify(obj) + '\n');
  } catch {
    // intentional no-op
  }
}

// ─── Ring buffer ────────────────────────────────────────────────────────────

/**
 * Create a fixed-capacity ring buffer over Buffer chunks.
 *
 * Stores raw bytes; when total exceeds `capBytes`, oldest chunks are
 * dropped (and the head chunk is sliced if needed) until total <= cap.
 *
 * `tail(n)` returns up to the last `n` bytes as a UTF-8 string.
 *
 * @param {number} capBytes
 */
export function _createRingBuffer(capBytes = 1_048_576) {
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;

  function write(chunk) {
    if (chunk == null) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (buf.length === 0) return;
    chunks.push(buf);
    total += buf.length;
    while (total > capBytes && chunks.length > 0) {
      const overflow = total - capBytes;
      const head = chunks[0];
      if (head.length <= overflow) {
        chunks.shift();
        total -= head.length;
      } else {
        chunks[0] = head.subarray(overflow);
        total -= overflow;
      }
    }
  }

  function tail(n = 4096) {
    if (chunks.length === 0) return '';
    const joined = Buffer.concat(chunks, total);
    const start = Math.max(0, joined.length - n);
    return joined.subarray(start).toString('utf8');
  }

  function size() {
    return total;
  }

  return { write, tail, size };
}

// ─── Free port allocation ───────────────────────────────────────────────────

/**
 * Ask the kernel for a free ephemeral TCP port on 127.0.0.1.
 *
 * Note: there's an inherent TOCTOU window between close() and the
 * subsequent listen by the child — callers should be prepared to retry
 * on EADDRINUSE. The retry loop in `_findFreePortWithRetry` handles that.
 *
 * @returns {Promise<number>}
 */
export function _findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('findFreePort: unexpected address shape')));
        return;
      }
      const p = addr.port;
      srv.close(() => resolve(p));
    });
  });
}

const FREE_PORT_BACKOFFS_MS = [50, 100, 200];

async function _findFreePortWithRetry() {
  let lastErr;
  for (let i = 0; i < FREE_PORT_BACKOFFS_MS.length; i++) {
    try {
      return await _findFreePort();
    } catch (err) {
      lastErr = err;
      await sleep(FREE_PORT_BACKOFFS_MS[i]);
    }
  }
  throw new Error(
    `lightpanda-spawner: failed to allocate free port after 3 retries: ${
      lastErr && lastErr.message ? lastErr.message : String(lastErr)
    }`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── CDP ready probe ────────────────────────────────────────────────────────

/**
 * Poll `GET http://<host>:<port>/json/version` until it responds 200,
 * the timeout elapses, or a non-refused HTTP error occurs.
 *
 * Backoff schedule: 50ms → 100ms → 200ms → 200ms (capped).
 *
 * @param {object} args
 * @param {string} args.host
 * @param {number} args.port
 * @param {number} args.timeoutMs
 * @param {typeof import('node:http')} [args.httpModule] - injectable for tests
 * @returns {Promise<void>}
 */
export function _waitForCdpReady({ host, port, timeoutMs, httpModule = http }) {
  const start = Date.now();
  const backoffs = [50, 100, 200];
  let attempt = 0;

  return new Promise((resolve, reject) => {
    function probe() {
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        reject(
          new Error(
            `lightpanda-spawner: CDP ready timeout after ${timeoutMs}ms ` +
              `(host=${host} port=${port})`
          )
        );
        return;
      }

      const req = httpModule.request(
        {
          host,
          port,
          path: '/json/version',
          method: 'GET',
          timeout: Math.max(250, timeoutMs - elapsed)
        },
        (res) => {
          // Drain body so the socket frees.
          res.resume();
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          reject(
            new Error(
              `lightpanda-spawner: CDP probe got unexpected status ` +
                `${res.statusCode} from /json/version`
            )
          );
        }
      );

      req.on('error', (err) => {
        // Connection-refused (and timeout/reset) → keep polling.
        const code = err && err.code;
        const refusedLike =
          code === 'ECONNREFUSED' ||
          code === 'ECONNRESET' ||
          code === 'EAI_AGAIN' ||
          code === 'ETIMEDOUT' ||
          code === 'EHOSTUNREACH';
        if (!refusedLike) {
          reject(err);
          return;
        }
        scheduleNext();
      });

      req.on('timeout', () => {
        try {
          req.destroy(new Error('probe-timeout'));
        } catch {
          // ignore
        }
      });

      try {
        req.end();
      } catch (err) {
        reject(err);
      }
    }

    function scheduleNext() {
      const delay = backoffs[Math.min(attempt, backoffs.length - 1)];
      attempt += 1;
      setTimeout(probe, delay);
    }

    probe();
  });
}

// ─── Bin path validation ────────────────────────────────────────────────────

function assertExecutable(binPath) {
  if (!binPath || typeof binPath !== 'string') {
    throw new Error(
      `lightpanda-spawner: binPath is required (got: ${
        binPath === undefined ? 'undefined' : JSON.stringify(binPath)
      })`
    );
  }
  let stat;
  try {
    stat = fs.statSync(binPath);
  } catch (err) {
    throw new Error(
      `lightpanda-spawner: binPath not found: ${binPath} (${err && err.message})`
    );
  }
  if (!stat.isFile()) {
    throw new Error(`lightpanda-spawner: binPath is not a regular file: ${binPath}`);
  }
  try {
    fs.accessSync(binPath, fs.constants.X_OK);
  } catch {
    throw new Error(`lightpanda-spawner: binPath is not executable: ${binPath}`);
  }
}

// ─── spawn() ────────────────────────────────────────────────────────────────

/**
 * Spawn a lightpanda CDP server child process.
 *
 * @param {object} [args]
 * @param {string} args.binPath - Absolute path to lightpanda binary.
 * @param {string} [args.host='127.0.0.1']
 * @param {number} [args.port=0] - 0 = auto-allocate free port.
 * @param {boolean} [args.obeyRobots=false]
 * @param {NodeJS.ProcessEnv} [args.env]
 * @param {number} [args.timeoutMs=5000] - CDP ready timeout
 * @param {object} [args._deps] - test injection seam
 * @param {Function} [args._deps.spawn]
 * @param {typeof import('node:http')} [args._deps.http]
 * @param {Function} [args._deps.findFreePort]
 * @param {Function} [args._deps.assertExecutable]
 * @returns {Promise<{
 *   wsEndpoint: string,
 *   kill: () => void,
 *   proc: import('node:child_process').ChildProcess,
 *   ringBuffer: ReturnType<typeof _createRingBuffer>,
 *   pid: number,
 *   startupMs: number
 * }>}
 */
export async function spawn({
  binPath,
  host = '127.0.0.1',
  port = 0,
  obeyRobots = false,
  env = process.env,
  timeoutMs = 5000,
  _deps = {}
} = {}) {
  const depSpawn = _deps.spawn || cpSpawn;
  const depHttp = _deps.http || http;
  const depFindFreePort = _deps.findFreePort || _findFreePortWithRetry;
  const depAssertExecutable = _deps.assertExecutable || assertExecutable;

  depAssertExecutable(binPath);

  // 1. Resolve port.
  const actualPort = port && port > 0 ? port : await depFindFreePort();

  // 2. Build args.
  const args = ['serve', '--host', host, '--port', String(actualPort)];
  if (obeyRobots === true) args.push('--obey-robots');

  // 3. Build child env (clone; do not mutate caller).
  const childEnv = { ...env };
  childEnv.LIGHTPANDA_DISABLE_TELEMETRY = 'true';
  if (env && env.LIGHTPANDA_TELEMETRY === 'true') {
    delete childEnv.LIGHTPANDA_DISABLE_TELEMETRY;
  }

  // 4. Spawn.
  const startedAt = Date.now();
  const proc = depSpawn(binPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv
  });

  // 5. Ring buffer capture (1MB; stdout + stderr combined).
  const ringBuffer = _createRingBuffer(1_048_576);
  if (proc.stdout && typeof proc.stdout.on === 'function') {
    proc.stdout.on('data', (chunk) => ringBuffer.write(chunk));
  }
  if (proc.stderr && typeof proc.stderr.on === 'function') {
    proc.stderr.on('data', (chunk) => ringBuffer.write(chunk));
  }

  // Track early exit (before CDP ready).
  let earlyExit = null;
  const earlyExitWaiters = [];
  const onEarlyExit = (code, signal) => {
    earlyExit = { code, signal };
    for (const fn of earlyExitWaiters) fn();
  };
  proc.once('exit', onEarlyExit);

  let killed = false;
  function kill() {
    if (killed) return;
    killed = true;
    try {
      proc.kill('SIGTERM');
    } catch {
      // process may already be gone
    }
  }

  // 6. Race CDP ready against early exit and timeout.
  try {
    await Promise.race([
      _waitForCdpReady({ host, port: actualPort, timeoutMs, httpModule: depHttp }),
      new Promise((_, reject) => {
        if (earlyExit) {
          reject(
            new Error(
              `lightpanda-spawner: child exited during startup ` +
                `(code=${earlyExit.code} signal=${earlyExit.signal})\n` +
                `--- tail ---\n${ringBuffer.tail()}`
            )
          );
          return;
        }
        earlyExitWaiters.push(() => {
          reject(
            new Error(
              `lightpanda-spawner: child exited during startup ` +
                `(code=${earlyExit.code} signal=${earlyExit.signal})\n` +
                `--- tail ---\n${ringBuffer.tail()}`
            )
          );
        });
      })
    ]);
  } catch (err) {
    // Detach early-exit handler so we don't fire the exited event for a
    // child we're about to kill anyway.
    proc.removeListener('exit', onEarlyExit);
    if (!earlyExit) {
      kill();
    }
    // Re-throw with ringBuffer tail context for timeout case.
    if (/CDP ready timeout/.test(err && err.message)) {
      throw new Error(`${err.message}\n--- tail ---\n${ringBuffer.tail()}`);
    }
    throw err;
  }

  // 7. CDP is ready. Replace early-exit handler with the post-success
  // exited-event emitter.
  proc.removeListener('exit', onEarlyExit);
  proc.once('exit', (code, signal) => {
    emitEvent({
      event: 'browser.exited',
      channel: 'lightpanda',
      pid: proc.pid,
      code,
      signal,
      tail: ringBuffer.tail()
    });
  });

  const startupMs = Date.now() - startedAt;
  const wsEndpoint = `ws://${host}:${actualPort}`;

  emitEvent({
    event: 'browser.spawned',
    channel: 'lightpanda',
    pid: proc.pid,
    wsEndpoint,
    startupMs
  });

  return {
    wsEndpoint,
    kill,
    proc,
    ringBuffer,
    pid: proc.pid,
    startupMs
  };
}
