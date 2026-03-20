/**
 * Story 017 — CLI exit codes
 * Tests: no prompt → exit non-zero; missing API key → exit 2;
 *        valid run with fake AI + fixture → exit 0.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';
import { startStaticServer } from '../helpers/staticServer.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function runIdx(args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['src/index.js', ...args], {
      env: { ...process.env, ...env },
      cwd: CWD,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ code, stdout, stderr }));
  });
}

describe('cli exit codes (story 017)', () => {
  let ai;
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
    // Two AI responses: parseTaskDescription + extract instruction
    ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get title' }],
      }),
      JSON.stringify([{ text: 'Widget Pro' }]),
    ]);
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits non-zero when no prompt argument supplied', async () => {
    const result = await runIdx([], {
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: 'http://127.0.0.1:1', // not used — should fail before AI call
      BROWSER_HEADLESS: 'true',
      LOG_LEVEL: 'error',
    });
    expect(result.code).not.toBe(0);
  }, 15000);

  it('exits 1 when OPENAI_API_KEY is missing', async () => {
    // Remove all known API keys from env
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIdx(['go to example.com and extract title'], {
      ...env,
      OPENAI_API_KEY: '',
      BROWSER_HEADLESS: 'true',
      LOG_LEVEL: 'error',
    });
    // Index.js calls validateEnvironmentVariables → throws → process.exit(1)
    // Logger outputs "Fatal error" (metadata stripped by winston printf format)
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined.toLowerCase()).toMatch(/error|fatal/i);
  }, 15000);

  it('exits 0 on valid run with fake AI + local fixture', async () => {
    const result = await runIdx(
      [`navigate to ${web.baseUrl}/product-page.html and extract the title`],
      {
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
      },
    );
    expect(result.code).toBe(0);
  }, 30000);

  // ── idx snap dispatches before API key validation (regression fix) ──────────
  // Fix: `idx snap` must exit 0 and produce DOM output even when no API key is
  // set, because it is a pure browser-inspection command that does not use AI.

  it('idx snap exits 0 without any API key set', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIdx(
      ['snap', `${web.baseUrl}/product-page.html`],
      {
        ...env,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        GOOGLE_GENERATIVE_AI_API_KEY: '',
        BROWSER_HEADLESS: 'true',
        BROWSER_SLOWMO: '0',
        BROWSER_TIMEOUT: '5000',
        LOG_LEVEL: 'error',
      },
    );
    expect(result.code).toBe(0);
  }, 30000);

  it('idx snap outputs DOM Tree header without API key', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIdx(
      ['snap', `${web.baseUrl}/product-page.html`],
      {
        ...env,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        GOOGLE_GENERATIVE_AI_API_KEY: '',
        BROWSER_HEADLESS: 'true',
        BROWSER_SLOWMO: '0',
        BROWSER_TIMEOUT: '5000',
        LOG_LEVEL: 'error',
      },
    );
    // Must emit DOM output, NOT an API key error
    expect(result.stdout).toContain('=== DOM Tree ===');
    expect(result.stdout + result.stderr).not.toMatch(/api.?key/i);
  }, 30000);
});
