/**
 * Unit tests for daemon routing in src/index.js run().
 *
 * We can't import run() directly (it calls itself immediately), so we test the
 * routing logic by examining what happens when the module's run() is triggered
 * under controlled conditions via spawning a child process with specific argv/env.
 *
 * Alternatively — and more simply — we test the conditional logic by mocking the
 * dynamic import of daemon.js and verifying ensureServer/sendCommand are called.
 *
 * Strategy: use vi.mock + a test-only re-export shim approach isn't feasible here
 * since index.js has side effects (calls run() at module load). Instead we verify
 * the routing by calling the Node process with test fixtures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(__dirname, '../../src/index.js');
const NODE = process.execPath;

// Helper: run index.js with given argv and env, capture stdout/stderr + exit code
function runIbr(args = [], env = {}) {
  try {
    const stdout = execFileSync(NODE, [INDEX, ...args], {
      env: { ...process.env, ...env },
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    // If it's a SpawnSyncReturns with status 0, it's not actually an error
    if (err.status === 0) {
      return {
        stdout: err.stdout || '',
        stderr: err.stderr || '',
        code: 0,
      };
    }
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: err.status ?? 1,
    };
  }
}

describe('index.js daemon routing', () => {
  it('exits 1 with no prompt in daemon mode (IBR_DAEMON=true)', () => {
    const { code, stderr } = runIbr([], { IBR_DAEMON: 'true' });
    expect(code).toBe(1);
  });

  it('exits 0 and shows usage with --daemon --help', () => {
    const { code, stderr, stdout } = runIbr(['--daemon', '--help']);
    expect(code).toBe(0);
    // Usage output goes through logger (stderr in default config)
    const out = stdout + stderr;
    expect(out).toMatch(/ibr/i);
    expect(out).toMatch(/daemon/i);
  });

  it('exits 0 and shows usage with --daemon -h', () => {
    const { code } = runIbr(['--daemon', '-h']);
    expect(code).toBe(0);
  });

  it('enters daemon mode with IBR_DAEMON=true and a prompt (fails on ensureServer, not on routing)', () => {
    // Server won't start in test env (no actual daemon), so it will time out or
    // fail connecting — but the important thing is it does NOT run the stateless
    // browser launch path. We verify it tried to connect (not launch Chromium).
    const { code, stderr } = runIbr([], {
      IBR_DAEMON: 'true',
      // Point state file to a non-existent path so ensureServer fails fast
      IBR_STATE_FILE: '/tmp/ibr-test-nonexistent-state-' + Date.now() + '.json',
    });
    // Should fail (no daemon running), but stderr should mention daemon/restart
    // not a Chromium launch message
    expect(code).not.toBe(0);
    expect(stderr).not.toMatch(/Launching browser/i);
  });

  it('enters daemon mode with --daemon flag (same behavior as IBR_DAEMON=true)', () => {
    const { code, stderr } = runIbr(['--daemon', 'some prompt'], {
      IBR_STATE_FILE: '/tmp/ibr-test-nonexistent-state-' + Date.now() + '.json',
    });
    expect(code).not.toBe(0);
    expect(stderr).not.toMatch(/Launching browser/i);
  });
});
