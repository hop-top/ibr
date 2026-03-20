/**
 * Daemon client helpers.
 * Used by index.js when IDX_DAEMON=true or --daemon flag is set.
 * No new dependencies — uses built-in http, child_process, fs, path, crypto.
 */

import { readFile } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(process.env.HOME || process.env.USERPROFILE || '', '.idx', 'server.json');
const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 8_000;
const HEALTH_TIMEOUT_MS = 2_000;
const COMMAND_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

/**
 * Read and parse ~/.idx/server.json.
 * Returns null on any error (missing, corrupt, etc.).
 * @returns {Promise<{pid:number, port:number, token:string}|null>}
 */
export async function readState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Process / health checks
// ---------------------------------------------------------------------------

/**
 * Check if a process with the given PID is alive.
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * HTTP GET /health with a short timeout.
 * @param {number} port
 * @param {string} _token - unused for health (no auth required)
 * @returns {Promise<boolean>}
 */
export async function healthCheck(port, _token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/**
 * Spawn the server process detached (fire-and-forget).
 * Polls state file until it appears and health check passes, or throws on timeout.
 * @returns {Promise<{port:number, token:string}>}
 */
export async function startServer() {
  const serverPath = path.join(__dirname, 'server.js');

  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();

  // Poll state file
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const state = await readState();
    if (state && state.port && state.token) {
      const alive = await healthCheck(state.port, state.token);
      if (alive) return { port: state.port, token: state.token };
    }
  }

  throw new Error(
    `idx daemon did not start within ${POLL_TIMEOUT_MS / 1000}s. ` +
    'Check logs or run: node src/server.js'
  );
}

/**
 * Ensure a healthy server is running.
 * - If state file missing / process dead / health fails → startServer().
 * @returns {Promise<{port:number, token:string}>}
 */
export async function ensureServer() {
  const state = await readState();

  if (state) {
    const alive = isProcessAlive(state.pid);
    if (alive) {
      const healthy = await healthCheck(state.port, state.token);
      if (healthy) return { port: state.port, token: state.token };
    }
  }

  // Stale or missing — start fresh
  return startServer();
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * POST /command with the given prompt.
 * On ECONNREFUSED (retries===0): re-ensure server and retry once.
 * On AbortError (timeout): print message and exit(1).
 * On success: write stdout and exit(0).
 *
 * @param {string} prompt
 * @param {number} port
 * @param {string} token
 * @param {number} [retries=0]
 */
export async function sendCommand(prompt, port, token, retries = 0) {
  const controller = new AbortController();
  // AbortSignal.timeout is available in Node 17.3+; fall back to manual timer
  const timer = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/command`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ command: 'task', args: [prompt] }),
    });
  } catch (err) {
    clearTimeout(timer);

    const isAbort = err.name === 'AbortError';
    const isConnRefused =
      err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED';

    if (isAbort) {
      process.stderr.write(
        `idx: command timed out after ${COMMAND_TIMEOUT_MS / 1000}s\n`
      );
      process.exit(1);
    }

    if (isConnRefused && retries === 0) {
      process.stderr.write('idx: daemon unreachable; restarting…\n');
      const { port: newPort, token: newToken } = await ensureServer();
      return sendCommand(prompt, newPort, newToken, 1);
    }

    // Unexpected error
    process.stderr.write(`idx: fetch error: ${err.message}\n`);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    let hint = '';
    try {
      const obj = JSON.parse(text);
      hint = obj.hint ? `\nHint: ${obj.hint}` : '';
      process.stderr.write(`idx: server error ${res.status}: ${obj.error}${hint}\n`);
    } catch {
      process.stderr.write(`idx: server error ${res.status}: ${text}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(text);
  process.stdout.write('\n');
  process.exit(0);
}
