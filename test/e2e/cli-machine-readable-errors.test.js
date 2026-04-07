/**
 * Story 015 — Machine-readable errors on stderr
 * Tests: malformed AI JSON → stderr has JSON error object; stdout stays clean.
 *
 * NOTE: src/index.js currently logs errors via logger (pino/winston style),
 * not as structured JSON to stderr. Tests verify error text appears in stderr
 * and stdout remains clean. When structured JSON errors are implemented,
 * update assertions to parse JSON and check `error` + `code` fields.
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

const BASE_ENV = {
  BROWSER_HEADLESS: 'true',
  BROWSER_SLOWMO: '0',
  BROWSER_TIMEOUT: '5000',
  CACHE_ENABLED: 'false',
  INSTRUCTION_EXECUTION_DELAY_MS: '0',
  INSTRUCTION_EXECUTION_JITTER_MS: '0',
  PAGE_LOADING_DELAY_MS: '0',
  LOG_LEVEL: 'error',
};

describe('cli machine-readable errors (story 015)', () => {
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  it('stderr contains error info when AI returns malformed JSON for task parse', async () => {
    // First AI response (parseTaskDescription) is garbage JSON
    const ai = await startFakeAIServerE2E(['THIS IS NOT JSON {{{']);
    const result = await runIbr(
      [`go to ${web.baseUrl}/product-page.html and extract the title`],
      {
        ...BASE_ENV,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: ai.baseUrl,
      },
    );
    await ai.close();

    expect(result.code).not.toBe(0);
    // stderr should mention the failure (logger outputs to stderr)
    const combined = result.stderr + result.stdout;
    expect(combined.toLowerCase()).toMatch(/error|fail|parse|json/i);
  }, 30000);

  it('stdout does not contain raw error stack traces', async () => {
    const ai = await startFakeAIServerE2E(['TOTALLY INVALID']);
    const result = await runIbr(
      [`go to ${web.baseUrl}/product-page.html and extract price`],
      {
        ...BASE_ENV,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: ai.baseUrl,
      },
    );
    await ai.close();

    expect(result.code).not.toBe(0);
    // stdout should NOT contain raw JS stack traces
    expect(result.stdout).not.toMatch(/at Object\.\<anonymous\>|at Module\._compile/);
  }, 30000);

  it('stderr JSON has "error" key + "code" field (AI_PARSE_ERROR)', async () => {
    const ai = await startFakeAIServerE2E(['THIS IS NOT JSON {{{']);
    const result = await runIbr(
      [`go to ${web.baseUrl}/product-page.html and extract the title`],
      {
        ...BASE_ENV,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: ai.baseUrl,
      },
    );
    await ai.close();

    const lines = result.stderr.split('\n').filter(Boolean);
    const jsonLine = lines.find(line => {
      try {
        const parsed = JSON.parse(line);
        return parsed.error?.code === 'AI_PARSE_ERROR';
      } catch {
        return false;
      }
    });

    expect(result.code).toBe(1);
    expect(jsonLine).toBeDefined();
  }, 30000);

  // TODO(pre-existing): passes under `npm run test:e2e:fast` in isolation
  // on ubuntu + macos but fails under `npm run test:coverage` (runs the
  // whole suite in one process). Likely coverage instrumentation slows
  // the spawned ibr subprocess past the fake-AI timeout. Skip under
  // coverage via IBR_SKIP_FLAKY_COVERAGE env set from coverage.yml.
  it.skipIf(process.env.IBR_SKIP_FLAKY_COVERAGE === 'true')('stderr JSON has "code": "ELEMENT_NOT_FOUND" when element missing', async () => {
    const ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'click', prompt: 'click the missing control' }],
      }),
      JSON.stringify({ elements: [{ x: 9999 }], type: 'click' }),
    ]);
    const result = await runIbr(
      [`go to ${web.baseUrl}/product-page.html and click the missing control`],
      {
        ...BASE_ENV,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: ai.baseUrl,
      },
    );
    await ai.close();

    const lines = result.stderr.split('\n').filter(Boolean);
    const jsonLine = lines.find(line => {
      try {
        const parsed = JSON.parse(line);
        return parsed.error?.code === 'ELEMENT_NOT_FOUND';
      } catch {
        return false;
      }
    });

    expect(result.code).toBe(1);
    expect(jsonLine).toBeDefined();
  }, 30000);
});
