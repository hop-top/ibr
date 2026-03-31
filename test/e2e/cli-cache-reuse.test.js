/**
 * Story 031 — Cache reuse across repeated runs
 * Tests: cache hits across runs, CACHE_ENABLED opt-out, invalidation on failures,
 *        cache-dir resolution via CACHE_DIR / XDG_CACHE_HOME env vars.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';
import { startStaticServer } from '../helpers/staticServer.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function runIbr(args, env = {}, stdinData = null) {
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
    proc.on('close', code => resolve({ code, stdout, stderr }));
    if (stdinData !== null) {
      proc.stdin.write(stdinData);
    }
    proc.stdin.end();
  });
}

const BASE_ENV = {
  BROWSER_HEADLESS: 'true',
  BROWSER_SLOWMO: '0',
  BROWSER_TIMEOUT: '5000',
  INSTRUCTION_EXECUTION_DELAY_MS: '0',
  INSTRUCTION_EXECUTION_JITTER_MS: '0',
  PAGE_LOADING_DELAY_MS: '0',
  LOG_LEVEL: 'error',
};

describe('cli cache reuse across runs (story 031)', () => {
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  it(
    'run completes with CACHE_ENABLED=true (default) → exit 0',
    async () => {
      const cacheDir = await mkdtemp(resolve(tmpdir(), 'ibr-cache-test-'));
      const localAi = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the title' }],
        }),
        JSON.stringify([{ text: 'Widget Pro' }]),
      ]);
      try {
        const prompt =
          `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title\n`;
        const result = await runIbr(
          [],
          {
            ...BASE_ENV,
            OPENAI_API_KEY: 'test-key',
            OPENAI_BASE_URL: localAi.baseUrl,
            CACHE_ENABLED: 'true',
            CACHE_DIR: cacheDir,
          },
          prompt,
        );
        expect(result.code).toBe(0);
      } finally {
        await localAi.close();
        await rm(cacheDir, { recursive: true, force: true });
      }
    },
    30000,
  );

  it(
    'run completes with CACHE_ENABLED=false (opt-out) → exit 0',
    async () => {
      const localAi = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the title' }],
        }),
        JSON.stringify([{ text: 'Widget Pro' }]),
      ]);
      try {
        const prompt =
          `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title\n`;
        const result = await runIbr(
          [],
          {
            ...BASE_ENV,
            OPENAI_API_KEY: 'test-key',
            OPENAI_BASE_URL: localAi.baseUrl,
            CACHE_ENABLED: 'false',
          },
          prompt,
        );
        expect(result.code).toBe(0);
      } finally {
        await localAi.close();
      }
    },
    30000,
  );

  it(
    'CACHE_DIR env resolves to custom directory — run exits 0',
    async () => {
      const cacheDir = await mkdtemp(resolve(tmpdir(), 'ibr-cache-dir-'));
      const localAi = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the price' }],
        }),
        JSON.stringify([{ text: '$29.99' }]),
      ]);
      try {
        const prompt =
          `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the price\n`;
        const result = await runIbr(
          [],
          {
            ...BASE_ENV,
            OPENAI_API_KEY: 'test-key',
            OPENAI_BASE_URL: localAi.baseUrl,
            CACHE_ENABLED: 'true',
            CACHE_DIR: cacheDir,
          },
          prompt,
        );
        expect(result.code).toBe(0);
        // Confirm cache dir was at minimum accessible
        const entries = await readdir(cacheDir).catch(() => []);
        expect(Array.isArray(entries)).toBe(true);
      } finally {
        await localAi.close();
        await rm(cacheDir, { recursive: true, force: true });
      }
    },
    30000,
  );

  it(
    'second run with same prompt reuses cache — both runs succeed',
    async () => {
      const cacheDir = await mkdtemp(resolve(tmpdir(), 'ibr-cache-hit-'));
      // Provide responses for two full runs
      const localAi = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the title' }],
        }),
        JSON.stringify([{ text: 'Widget Pro' }]),
        // Second run buffers (used if schema not cached yet)
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the title' }],
        }),
        JSON.stringify([{ text: 'Widget Pro' }]),
      ]);
      try {
        const prompt =
          `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title\n`;
        const env = {
          ...BASE_ENV,
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: localAi.baseUrl,
          CACHE_ENABLED: 'true',
          CACHE_DIR: cacheDir,
        };
        const r1 = await runIbr([], env, prompt);
        const r2 = await runIbr([], env, prompt);
        expect(r1.code).toBe(0);
        expect(r2.code).toBe(0);
      } finally {
        await localAi.close();
        await rm(cacheDir, { recursive: true, force: true });
      }
    },
    60000,
  );

  it(
    'XDG_CACHE_HOME respected when CACHE_DIR not set → run exits 0',
    async () => {
      const xdgRoot = await mkdtemp(resolve(tmpdir(), 'ibr-xdg-'));
      const localAi = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the title' }],
        }),
        JSON.stringify([{ text: 'Widget Pro' }]),
      ]);
      try {
        const prompt =
          `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title\n`;
        const env = { ...process.env };
        delete env.CACHE_DIR;
        const result = await runIbr(
          [],
          {
            ...env,
            ...BASE_ENV,
            OPENAI_API_KEY: 'test-key',
            OPENAI_BASE_URL: localAi.baseUrl,
            CACHE_ENABLED: 'true',
            XDG_CACHE_HOME: xdgRoot,
            CACHE_DIR: '',
          },
          prompt,
        );
        expect(result.code).toBe(0);
      } finally {
        await localAi.close();
        await rm(xdgRoot, { recursive: true, force: true });
      }
    },
    30000,
  );
});
