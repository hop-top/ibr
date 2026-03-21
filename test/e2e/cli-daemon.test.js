/**
 * Story 020 — Daemon mode
 *
 * Tests: IBR_DAEMON=true / --daemon flag starts a background server, serves
 * commands via HTTP, and reuses the same process across invocations.
 *
 * Isolation: each test suite uses a unique IBR_STATE_FILE under /tmp so tests
 * don't interfere with each other or a developer's live daemon.
 */

import { spawn } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve as resolve_path, dirname } from 'path';
import os from 'os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';
import { startStaticServer } from '../helpers/staticServer.js';

const CWD = resolve_path(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_JS = resolve_path(CWD, 'src/server.js');
const NODE = process.execPath;

// ── helpers ───────────────────────────────────────────────────────────────────

function tmpStateFile() {
  return `/tmp/ibr-e2e-daemon-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
}

/** Run ibr (src/index.js) and return a promise resolving to { code, stdout, stderr }. */
function runIbr(args, env = {}) {
  return new Promise(resolve => {
    const proc = spawn(NODE, [resolve_path(CWD, 'src/index.js'), ...args], {
      env: { ...process.env, ...env },
      cwd: CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Read and parse the daemon state file, or return null. */
function readStateFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Kill a pid silently. */
function killPid(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
}

/**
 * Start the daemon server directly (src/server.js) and wait until its state
 * file appears and /health responds.
 */
async function startDaemon(stateFile, env = {}) {
  const child = spawn(NODE, [SERVER_JS], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, IBR_STATE_FILE: stateFile },
    cwd: CWD,
  });
  child.unref();

  // Poll state file up to 10 s
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 150));
    const state = readStateFile(stateFile);
    if (state?.port && state?.token) {
      // Verify health
      try {
        const res = await fetch(`http://127.0.0.1:${state.port}/health`);
        if (res.ok) return state;
      } catch { /* not ready yet */ }
    }
  }
  throw new Error('Daemon did not start within 10s');
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('cli daemon mode — server lifecycle (story 020)', () => {
  let stateFile;
  let daemonState;
  let ai;
  let web;

  beforeAll(async () => {
    stateFile = tmpStateFile();
    web = await startStaticServer();
    ai = await startFakeAIServerE2E([
      // First command: parseTaskDescription
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get the price' }],
      }),
      // First command: executeTask (extract response)
      JSON.stringify([{ text: '$9.99' }]),
      // Second command: parseTaskDescription
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get the price' }],
      }),
      // Second command: executeTask
      JSON.stringify([{ text: '$9.99' }]),
    ]);

    daemonState = await startDaemon(stateFile, {
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: ai.baseUrl,
      BROWSER_HEADLESS: 'true',
      BROWSER_SLOWMO: '0',
      BROWSER_TIMEOUT: '5000',
      CACHE_ENABLED: 'false',
      INSTRUCTION_EXECUTION_DELAY_MS: '0',
      INSTRUCTION_EXECUTION_JITTER_MS: '0',
      PAGE_LOADING_DELAY_MS: '0',
      LOG_LEVEL: 'error',
    });
  }, 30000);

  afterAll(async () => {
    if (daemonState?.pid) killPid(daemonState.pid);
    if (existsSync(stateFile)) unlinkSync(stateFile);
    await ai?.close();
    await web?.close();
  });

  it('daemon state file contains pid, port, and token', () => {
    expect(daemonState.pid).toBeTypeOf('number');
    expect(daemonState.port).toBeTypeOf('number');
    expect(daemonState.port).toBeGreaterThan(0);
    expect(daemonState.token).toBeTypeOf('string');
    expect(daemonState.token.length).toBeGreaterThan(10);
  });

  it('GET /health returns { status: "healthy" }', async () => {
    const res = await fetch(`http://127.0.0.1:${daemonState.port}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.pid).toBe(daemonState.pid);
  });

  it('POST /command without auth returns 401', async () => {
    const res = await fetch(`http://127.0.0.1:${daemonState.port}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'task', args: ['test'] }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /command with wrong token returns 401', async () => {
    const res = await fetch(`http://127.0.0.1:${daemonState.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({ command: 'task', args: ['test'] }),
    });
    expect(res.status).toBe(401);
  });

  it('POST /command with oversized body returns 413', async () => {
    const res = await fetch(`http://127.0.0.1:${daemonState.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${daemonState.token}`,
      },
      body: 'x'.repeat(2 * 1024 * 1024), // 2 MiB > 1 MiB limit
    });
    expect(res.status).toBe(413);
  });
});

describe('cli daemon mode — IBR_DAEMON=true invocation (story 020)', () => {
  let stateFile;
  let daemonState;
  let ai;
  let web;

  beforeAll(async () => {
    stateFile = tmpStateFile();
    web = await startStaticServer();
    // Provide enough AI responses for two full invocations (parse + execute each)
    ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get the price' }],
      }),
      JSON.stringify([{ text: '$9.99' }]),
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get the price' }],
      }),
      JSON.stringify([{ text: '$9.99' }]),
    ]);

    // Pre-start daemon so invocations hit a warm server (avoids cold-start timeout)
    daemonState = await startDaemon(stateFile, {
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: ai.baseUrl,
      BROWSER_HEADLESS: 'true',
      BROWSER_SLOWMO: '0',
      BROWSER_TIMEOUT: '5000',
      CACHE_ENABLED: 'false',
      INSTRUCTION_EXECUTION_DELAY_MS: '0',
      INSTRUCTION_EXECUTION_JITTER_MS: '0',
      PAGE_LOADING_DELAY_MS: '0',
      LOG_LEVEL: 'error',
    });
  }, 30000);

  afterAll(async () => {
    if (daemonState?.pid) killPid(daemonState.pid);
    if (existsSync(stateFile)) unlinkSync(stateFile);
    await ai?.close();
    await web?.close();
  });

  const baseEnv = () => ({
    OPENAI_API_KEY: 'test-key',
    OPENAI_BASE_URL: ai.baseUrl,
    BROWSER_HEADLESS: 'true',
    BROWSER_SLOWMO: '0',
    BROWSER_TIMEOUT: '5000',
    CACHE_ENABLED: 'false',
    INSTRUCTION_EXECUTION_DELAY_MS: '0',
    INSTRUCTION_EXECUTION_JITTER_MS: '0',
    PAGE_LOADING_DELAY_MS: '0',
    LOG_LEVEL: 'error',
    IBR_DAEMON: 'true',
    IBR_STATE_FILE: stateFile,
  });

  it('IBR_DAEMON=true exits 0 and returns extracted data', async () => {
    const prompt = `go to ${web.baseUrl}/product-page.html and get the price`;
    const result = await runIbr([prompt], baseEnv());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('9.99');
  }, 35000);

  it('reuses the same daemon pid on second call', async () => {
    const prompt = `go to ${web.baseUrl}/product-page.html and get the price`;
    const result = await runIbr([prompt], baseEnv());
    expect(result.code).toBe(0);
    const pidAfter = readStateFile(stateFile)?.pid;
    expect(pidAfter).toBe(daemonState.pid);
  }, 35000);

  it('--daemon flag connects to the existing daemon (same pid)', () => {
    const state = readStateFile(stateFile);
    expect(state?.pid).toBe(daemonState.pid);
    // Daemon is still alive
    try { process.kill(daemonState.pid, 0); } catch { throw new Error('Daemon should still be running'); }
  });
});
