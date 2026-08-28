/**
 * Shared e2e helper: spawn the ibr daemon (src/server.js) and tear it down
 * safely.
 *
 * Root-cause fix for the orphaned-daemon leak: the daemon is spawned
 * detached (so it survives its own spawner), which means the RAW child
 * handle must be captured and reapable from the moment `spawn()` returns —
 * not only once the health poll resolves. Previously the health poll could
 * throw (cold start under load exceeding the poll window) before the
 * caller's `daemonState` var was ever assigned, leaving the already-running
 * detached process with no reference anyone could kill. It would then only
 * exit via its own IDLE_TIMEOUT_MS (default 30 min), holding a browser the
 * whole time.
 *
 * Fix shape:
 *  - capture `child` immediately after spawn, before the poll starts.
 *  - wrap the poll in try/catch: on timeout, reap the child (process GROUP,
 *    since detached:true means the daemon's own children — its browser —
 *    are in the same group) before rethrowing.
 *  - `stopDaemon` always kills via the raw handle's pid, never via a
 *    resolved daemonState that might not exist.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));
const CWD = resolvePath(HELPERS_DIR, '..', '..');
const SERVER_JS = resolvePath(CWD, 'src', 'server.js');
const NODE = process.execPath;

const DEFAULT_POLL_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 150;

function readStateFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Kill a process GROUP by pid, silently ignoring "already gone" errors.
 * Negative pid targets the whole group started by a detached child, so the
 * daemon's own browser subprocesses are reaped too, not just the daemon.
 */
function killProcessGroup(pid, signal = 'SIGTERM') {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (err) {
    if (err && (err.code === 'ESRCH' || err.code === 'EPERM')) return;
    // Fall back to killing just the pid (e.g. platforms/setups where the
    // negative-pid group kill itself errors for a reason other than
    // "already gone") — best-effort, never throw out of a reaper.
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

/**
 * Start the daemon server directly (src/server.js) and wait until its state
 * file appears and /health responds. Detached + unref so it survives this
 * process — the daemon (and its owned browser) are only supposed to be
 * killed by an explicit `stopDaemon`, never left as a permanent orphan.
 *
 * If the health poll times out, the just-spawned process group is reaped
 * BEFORE the timeout error is thrown, so a beforeAll rejection can never
 * leave an unreachable orphan behind.
 *
 * @param {string} stateFile
 * @param {Record<string,string>} env
 * @param {{ pollTimeoutMs?: number, pollIntervalMs?: number }} [opts]
 * @returns {Promise<{ pid: number, port: number, token: string, child: import('node:child_process').ChildProcess }>}
 */
export async function startDaemon(stateFile, env = {}, opts = {}) {
  const pollTimeoutMs = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const child = spawn(NODE, [SERVER_JS], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, IBR_STATE_FILE: stateFile },
    cwd: CWD,
  });
  child.unref();

  try {
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      const state = readStateFile(stateFile);
      if (state?.port && state?.token) {
        try {
          const res = await fetch(`http://127.0.0.1:${state.port}/health`);
          if (res.ok) return { ...state, child };
        } catch { /* not ready yet */ }
      }
    }
    throw new Error('Daemon did not start within ' + pollTimeoutMs + 'ms');
  } catch (err) {
    // Reap-on-throw: the detached process is already running and owns a
    // browser by this point — never let the caller's rejection orphan it.
    killProcessGroup(child.pid, 'SIGTERM');
    throw err;
  }
}

/**
 * Stop a daemon started by startDaemon. Always keys off the raw pid/child
 * captured at spawn time (`daemonState.pid` / `daemonState.child`) — NEVER
 * off a value that might be unassigned because beforeAll threw.
 *
 * @param {{ pid?: number, child?: import('node:child_process').ChildProcess } | null | undefined} handle
 */
export function stopDaemon(handle) {
  if (!handle) return;
  const pid = handle.pid ?? handle.child?.pid;
  killProcessGroup(pid, 'SIGTERM');
}
