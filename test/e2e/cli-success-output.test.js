/**
 * Story 030 — Structured Success Output Contract
 * Tests: CLI success JSON shape and stderr/stdout separation
 *
 * The daemon mode writes { extracts, tokenUsage } JSON to stdout (after log lines).
 * Structured errors are emitted as JSON to stderr.
 * Human-readable logs go to stdout (Console transport default) — tests account for this.
 */
import { spawn } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve as resolvePath, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';
import { startStaticServer } from '../helpers/staticServer.js';

const CWD = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER_JS = resolvePath(CWD, 'src/server.js');
const NODE = process.execPath;

function tmpStateFile() {
  return `/tmp/ibr-e2e-success-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
}

function runIbr(args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn(NODE, [resolvePath(CWD, 'src/index.js'), ...args], {
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

function readStateFile(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function killPid(pid) {
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
}

async function startDaemon(stateFile, env = {}) {
  const child = spawn(NODE, [SERVER_JS], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, IBR_STATE_FILE: stateFile },
    cwd: CWD,
  });
  child.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 150));
    const state = readStateFile(stateFile);
    if (state?.port && state?.token) {
      try {
        const res = await fetch(`http://127.0.0.1:${state.port}/health`);
        if (res.ok) return state;
      } catch { /* not ready yet */ }
    }
  }
  throw new Error('Daemon did not start within 10s');
}

/**
 * Extract a JSON object from stdout that may also contain log lines.
 * Searches each line for the start of a top-level JSON object.
 */
function extractJsonFromOutput(text) {
  const lines = text.split('\n');
  // Try from the end to find the last line that starts a JSON block
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{')) {
      // Try to parse from this line to end of string
      const candidate = lines.slice(i).join('\n');
      try {
        return JSON.parse(candidate);
      } catch { /* keep searching */ }
    }
  }
  // Fallback: find first '{' on its own line and parse from there
  const idx = text.indexOf('\n{');
  if (idx !== -1) {
    try { return JSON.parse(text.slice(idx + 1)); } catch { return null; }
  }
  return null;
}

const BASE_ENV = {
  BROWSER_HEADLESS: 'true',
  BROWSER_SLOWMO: '0',
  BROWSER_TIMEOUT: '5000',
  CACHE_ENABLED: 'false',
  INSTRUCTION_EXECUTION_DELAY_MS: '0',
  INSTRUCTION_EXECUTION_JITTER_MS: '0',
  PAGE_LOADING_DELAY_MS: '0',
  LOG_LEVEL: 'error',
  OPENAI_API_KEY: 'test-key',
};

// ── Daemon success payload shape ─────────────────────────────────────────────

describe('cli success output — daemon mode (story 030)', () => {
  let stateFile;
  let daemonState;
  let ai;
  let web;

  beforeAll(async () => {
    stateFile = tmpStateFile();
    web = await startStaticServer();
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

    daemonState = await startDaemon(stateFile, {
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: ai.baseUrl,
      ...BASE_ENV,
    });
  }, 30000);

  afterAll(async () => {
    if (daemonState?.pid) killPid(daemonState.pid);
    if (existsSync(stateFile)) unlinkSync(stateFile);
    await ai?.close();
    await web?.close();
  });

  it('daemon success payload contains parseable JSON on stdout', async () => {
    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the price`;
    const result = await runIbr(
      [prompt],
      {
        ...BASE_ENV,
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_DAEMON: 'true',
        IBR_STATE_FILE: stateFile,
      },
    );
    expect(result.code).toBe(0);
    // stdout contains log lines followed by the JSON payload — find last JSON object
    const parsed = extractJsonFromOutput(result.stdout);
    expect(parsed).not.toBeNull();
  }, 35000);

  it('daemon success payload includes extracts and tokenUsage top-level keys', async () => {
    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the price`;
    const result = await runIbr(
      [prompt],
      {
        ...BASE_ENV,
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_DAEMON: 'true',
        IBR_STATE_FILE: stateFile,
      },
    );
    expect(result.code).toBe(0);
    const parsed = extractJsonFromOutput(result.stdout);
    expect(parsed).not.toBeNull();
    // Required top-level keys per story 030 schema
    expect(parsed).toHaveProperty('extracts');
    expect(parsed).toHaveProperty('tokenUsage');
    expect(Array.isArray(parsed.extracts)).toBe(true);
    expect(typeof parsed.tokenUsage).toBe('object');
  }, 35000);
});

// ── Stateless CLI stdout/stderr separation ────────────────────────────────────

describe('cli success output — stderr/stdout separation (story 030)', () => {
  let ai;
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFakeAIServerE2E([]);
  }, 15000);

  afterAll(async () => {
    await ai?.close();
    await web?.close();
  });

  it('structured error JSON emitted to stderr on failure (missing API key)', async () => {
    // Missing API key → emitStructuredError writes JSON to stderr
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract title`;
    const result = await runIbr(
      [prompt],
      {
        ...env,
        BROWSER_HEADLESS: 'true',
        BROWSER_TIMEOUT: '5000',
        CACHE_ENABLED: 'false',
        LOG_LEVEL: 'error',
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        GOOGLE_GENERATIVE_AI_API_KEY: '',
      },
    );
    expect(result.code).not.toBe(0);
    // emitStructuredError writes { "error": { "code": ..., "message": ... } } to stderr
    expect(result.stderr).toContain('"error"');
    // stderr must be valid JSON
    const stderrContent = result.stderr.trim();
    expect(() => JSON.parse(stderrContent)).not.toThrow();
    const parsed = JSON.parse(stderrContent);
    expect(parsed).toHaveProperty('error');
    expect(parsed.error).toHaveProperty('code');
    expect(parsed.error).toHaveProperty('message');
  }, 15000);

  it('stateless CLI exits 0 on successful run (no-extract run)', async () => {
    await ai.close();
    ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'click', prompt: 'click nonexistent button' }],
      }),
      // Action: no elements found (skips gracefully)
      JSON.stringify({ elements: [], type: 'click' }),
    ]);

    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - click a button`;
    const result = await runIbr(
      [prompt],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
  }, 35000);

  it('stateless CLI success: stdout contains no structured error JSON', async () => {
    await ai.close();
    ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get the title' }],
      }),
      JSON.stringify([{ text: 'Widget Pro' }]),
    ]);

    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title`;
    const result = await runIbr(
      [prompt],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    // On success, stdout must NOT contain a structured error object
    expect(result.stdout).not.toContain('"code":"RUNTIME_ERROR"');
    expect(result.stdout).not.toContain('"code":"CONFIG_ERROR"');
    // stderr should also not contain structured errors on success
    expect(result.stderr).not.toContain('"error"');
  }, 35000);
});
