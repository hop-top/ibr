/**
 * Story 028 — Page Representation Control
 * Tests: forced DOM/ARIA mode, auto selection, invalid mode handling
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';
import { startStaticServer } from '../helpers/staticServer.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function runIbr(args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['src/index.js', ...args], {
      env: { ...process.env, ...env },
      cwd: CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
    proc.stdin.end();
  });
}

const BASE_ENV = {
  BROWSER_HEADLESS: 'true',
  BROWSER_SLOWMO: '0',
  BROWSER_TIMEOUT: '10000',
  CACHE_ENABLED: 'false',
  INSTRUCTION_EXECUTION_DELAY_MS: '0',
  INSTRUCTION_EXECUTION_JITTER_MS: '0',
  PAGE_LOADING_DELAY_MS: '0',
  LOG_LEVEL: 'error',
  OPENAI_API_KEY: 'test-key',
};

describe('cli --mode flag (story 028)', () => {
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

  it('--mode dom forces DOM simplification mode — exits 0', async () => {
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
      ['--mode', 'dom', prompt],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
  }, 35000);

  it('--mode aria forces ARIA mode — exits 0', async () => {
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
      ['--mode', 'aria', prompt],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
  }, 35000);

  it('--mode auto (explicit) uses runtime heuristics — exits 0', async () => {
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
      ['--mode', 'auto', prompt],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
  }, 35000);

  it('invalid --mode value exits non-zero with descriptive usage error', async () => {
    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract title`;
    const result = await runIbr(
      ['--mode', 'invalid_mode', prompt],
      {
        ...BASE_ENV,
        OPENAI_BASE_URL: ai.baseUrl,
      },
    );
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    // Must mention valid modes or describe the invalid value
    expect(combined).toMatch(/invalid.*mode|must be one of|aria.*dom.*auto/i);
  }, 15000);

  it('auto-mode selection logs chosen mode when LOG_LEVEL is info', async () => {
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
      {
        ...BASE_ENV,
        OPENAI_BASE_URL: ai.baseUrl,
        LOG_LEVEL: 'info',
      },
    );
    expect(result.code).toBe(0);
    // Auto mode should log the selected mode + reason
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/aria mode|dom mode|falling back/i);
  }, 35000);
});
