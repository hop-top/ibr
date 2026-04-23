/**
 * E2E tests for browser features:
 *   1. snap current — BROWSER_REUSE_PAGE + url "current"
 *   2. popup preemptive switch — auto-switch context
 *   3. strict mode scoping — disambiguate identical links
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { startFromCassette } from './helpers/vcr.js';
import { startStaticServer } from '../helpers/staticServer.js';

const CWD = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);

function runIbr(args, env = {}) {
  return new Promise((res) => {
    const proc = spawn(
      'node',
      ['src/index.js', ...args],
      {
        env: { ...process.env, ...env },
        cwd: CWD,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      res({ code: code ?? 1, stdout, stderr });
    });
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
  XRR_MODE: 'passthrough',
};

// ─── snap current ──────────────────────────────────

describe('snap current (BROWSER_REUSE_PAGE)', () => {
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  it(
    'snap with url "current" exits 0 and outputs DOM',
    async () => {
      // Without CDP, fresh browser has about:blank page.
      // BROWSER_REUSE_PAGE + "current" should still work
      // (reuses the blank page, no navigation error).
      const result = await runIbr(
        ['snap', 'current'],
        {
          ...BASE_ENV,
          BROWSER_REUSE_PAGE: 'true',
          OPENAI_API_KEY: '',
        },
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('=== DOM Tree ===');
    },
    30000,
  );

  it(
    'snap normal URL still navigates and returns content',
    async () => {
      const result = await runIbr(
        ['snap', `${web.baseUrl}/alias-settings.html`],
        {
          ...BASE_ENV,
          OPENAI_API_KEY: '',
        },
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('=== DOM Tree ===');
      expect(result.stdout).toContain('Email Aliases');
    },
    30000,
  );
});

// ─── popup preemptive switch ───────────────────────

describe('popup preemptive switch', () => {
  let web, ai;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette(
      'browser-popup-switch',
      { SERVER_URL: web.baseUrl },
    );
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it(
    'auto-switches to popup after click opens new window',
    async () => {
      const prompt = [
        `url: ${web.baseUrl}/alias-settings.html`,
        'instructions:',
        '  - click Add another email address',
        '  - fill the Name field with Test',
        '  - fill the Email field with test@example.com',
      ].join('\n');

      const result = await runIbr(
        [prompt],
        {
          ...BASE_ENV,
          LOG_LEVEL: 'info',
          OPENAI_BASE_URL: ai.baseUrl,
        },
      );

      const combined = result.stdout + result.stderr;
      // Should detect and switch to popup
      expect(combined).toMatch(
        /[Ss]witching to popup/,
      );
      expect(result.code).toBe(0);
    },
    60000,
  );
});

// ─── strict mode scoping ──────────────────────────

describe('strict mode scoping', () => {
  let web, ai;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette(
      'browser-strict-scoping',
      { SERVER_URL: web.baseUrl },
    );
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it(
    'disambiguates identical links using prompt context',
    async () => {
      const prompt = [
        `url: ${web.baseUrl}/alias-settings.html`,
        'instructions:',
        '  - click delete next to test@example.com',
      ].join('\n');

      const result = await runIbr(
        [prompt],
        {
          ...BASE_ENV,
          LOG_LEVEL: 'info',
          OPENAI_BASE_URL: ai.baseUrl,
        },
      );

      const combined = result.stdout + result.stderr;
      // Should log scoping message when multiple
      // matches are found
      expect(combined).toMatch(
        /[Mm]ultiple matches.*scoped to prompt/,
      );
      expect(result.code).toBe(0);
    },
    60000,
  );
});
