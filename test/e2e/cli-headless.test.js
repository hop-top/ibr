/**
 * Story 014 — CLI headless mode
 * Tests: BROWSER_HEADLESS=true completes successfully without visible window.
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
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => resolve({ code, stdout, stderr }));
  });
}

describe('cli headless mode (story 014)', () => {
  let ai;
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get the price' }],
      }),
      JSON.stringify([{ text: '$9.99' }]),
    ]);
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('completes with BROWSER_HEADLESS=true and exits 0', async () => {
    const result = await runIbr(
      [`go to ${web.baseUrl}/product-page.html and get the price`],
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

  it('does not mention a visible window or display in output', async () => {
    const ai2 = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get rating' }],
      }),
      JSON.stringify([{ text: '4.5 stars' }]),
    ]);

    const result = await runIbr(
      [`visit ${web.baseUrl}/product-page.html and get rating`],
      {
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: ai2.baseUrl,
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
    await ai2.close();

    expect(result.code).toBe(0);
    // No Xvfb / display errors on macOS headless
    expect(result.stderr).not.toMatch(/cannot open display|xvfb/i);
  }, 30000);
});
