/**
 * Story 018 — Execution timeout
 *
 * EXECUTION_TIMEOUT_MS is a global wall-clock limit for the entire run.
 * src/index.js does NOT currently support EXECUTION_TIMEOUT_MS.
 * All tests in this file are skipped until that feature is implemented.
 *
 * To implement: wrap the Operations.executeTask() call with a
 * Promise.race([task, timeout]) where timeout rejects with
 * { code: "TIMEOUT" } after EXECUTION_TIMEOUT_MS milliseconds,
 * then write that as JSON to stderr and call process.exit(1).
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

describe('cli timeout (story 018)', () => {
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  it(
    'EXECUTION_TIMEOUT_MS=1000 + slow-page.html exits 1 with TIMEOUT',
    async () => {
      const ai = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/slow-page.html`,
          instructions: [{ name: 'extract', prompt: 'extract dynamic content' }],
        }),
        JSON.stringify([{ text: 'Loaded' }]),
      ]);
      const result = await runIbr(
        [`go to ${web.baseUrl}/slow-page.html and extract dynamic content`],
        {
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: ai.baseUrl,
          BROWSER_HEADLESS: 'true',
          BROWSER_SLOWMO: '0',
          CACHE_ENABLED: 'false',
          INSTRUCTION_EXECUTION_DELAY_MS: '0',
          INSTRUCTION_EXECUTION_JITTER_MS: '0',
          PAGE_LOADING_DELAY_MS: '2000',
          LOG_LEVEL: 'error',
          EXECUTION_TIMEOUT_MS: '1000',
        },
      );
      await ai.close();
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/"code":"TIMEOUT"/);
    },
    10000,
  );

  it(
    'stderr contains JSON error with code: "TIMEOUT"',
    async () => {
      const ai = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/slow-page.html`,
          instructions: [{ name: 'extract', prompt: 'extract dynamic content' }],
        }),
        JSON.stringify([{ text: 'Loaded' }]),
      ]);
      const result = await runIbr(
        [`go to ${web.baseUrl}/slow-page.html and extract dynamic content`],
        {
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: ai.baseUrl,
          BROWSER_HEADLESS: 'true',
          PAGE_LOADING_DELAY_MS: '2000',
          EXECUTION_TIMEOUT_MS: '1000',
          LOG_LEVEL: 'error',
        },
      );
      await ai.close();
      const jsonMatch = result.stderr.match(/\{"error":\{.*"code":"TIMEOUT".*\}\}/s);
      expect(jsonMatch).toBeTruthy();
      expect(JSON.parse(jsonMatch[0]).error.code).toBe('TIMEOUT');
    },
    10000,
  );

  it(
    'BROWSER_TIMEOUT (per-element wait) does not trigger the global timeout',
    async () => {
      const ai2 = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/slow-page.html`,
          instructions: [{ name: 'click', prompt: 'click the missing control' }],
        }),
        JSON.stringify({ elements: [{ x: 9999 }], type: 'click' }),
      ]);
      const result = await runIbr(
        [`go to ${web.baseUrl}/slow-page.html and click the missing control`],
        {
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: ai2.baseUrl,
          BROWSER_HEADLESS: 'true',
          BROWSER_TIMEOUT: '500',
          EXECUTION_TIMEOUT_MS: '30000',
          LOG_LEVEL: 'error',
        },
      );
      await ai2.close();
      expect(result.stderr).not.toMatch(/"code"\s*:\s*"TIMEOUT"/);
    },
    15000,
  );
});
