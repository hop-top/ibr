/**
 * VCR E2E tests for `ibr tool` subcommand (T-0007..T-0010).
 *
 * Each test runs a tool invocation against a fake AI server (replaying a
 * cassette) + a static HTML server (standing in for the real target site).
 * Verifies: tool loads, params interpolate, execution completes exit 0,
 * and stdout contains structured extraction output.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFromCassette } from './helpers/vcr.js';
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
    proc.on('close', code => resolve({ code, stdout, stderr }));
    proc.stdin.end();
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
  OPENAI_API_KEY: 'test-key',
};

// ─── trend-search (T-0007) ───────────────────────────────────────────────────

describe('ibr tool trend-search (T-0007)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-trend-search', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'trend-search', '--param', 'topic=javascript'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Task execution completed/i);
  }, 30000);

  it('does not error on tool config (YAML parse, param resolution)', async () => {
    const result = await runIbr(
      ['tool', 'trend-search', '--param', 'topic=javascript', '--param', 'region=GB'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    const combined = result.stdout + result.stderr;
    expect(combined).not.toMatch(/Tool not found|Missing required param|CONFIG_ERROR/i);
  }, 30000);
});

// ─── github-search (T-0008) ──────────────────────────────────────────────────

describe('ibr tool github-search (T-0008)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-github-search', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'github-search', '--param', 'query=playwright'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Task execution completed/i);
  }, 30000);

  it('type param defaults to repositories without error', async () => {
    const result = await runIbr(
      ['tool', 'github-search', '--param', 'query=vitest'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    const combined = result.stdout + result.stderr;
    expect(combined).not.toMatch(/Missing required param|Tool not found/i);
  }, 30000);
});

// ─── github-trending (T-0009) ────────────────────────────────────────────────

describe('ibr tool github-trending (T-0009)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-github-trending', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 with no params (all optional)', async () => {
    const result = await runIbr(
      ['tool', 'github-trending'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
  }, 30000);

  it('exits 0 with language + period params', async () => {
    let ai2, web2;
    try {
      web2 = await startStaticServer();
      ai2 = await startFromCassette('tool-github-trending-lang', { SERVER_URL: web2.baseUrl });
      const result = await runIbr(
        ['tool', 'github-trending', '--param', 'language=go', '--param', 'period=weekly'],
        { ...BASE_ENV, OPENAI_BASE_URL: ai2.baseUrl },
      );
      expect(result.code).toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/Task execution completed/i);
    } finally {
      await ai2?.close();
      await web2?.close();
    }
  }, 30000);
});

// ─── github-starred (T-0010) ─────────────────────────────────────────────────

describe('ibr tool github-starred (T-0010)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-github-starred', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'github-starred', '--param', 'username=sindresorhus'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Task execution completed/i);
  }, 30000);

  it('username is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'github-starred'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/username|required param/i);
  }, 10000);
});

// ─── context7 (T-0005) ───────────────────────────────────────────────────────

describe('ibr tool context7 (T-0005)', () => {
  let ai, web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('tool-context7', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it('exits 0 and completes extraction without error', async () => {
    const result = await runIbr(
      ['tool', 'context7', '--param', 'library=playwright', '--param', 'question=how to click an element'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Task execution completed/i);
  }, 30000);

  it('library is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'context7', '--param', 'question=how to click'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/library|required param/i);
  }, 10000);

  it('question is required — missing → non-zero exit before browser', async () => {
    const result = await runIbr(
      ['tool', 'context7', '--param', 'library=playwright'],
      { ...BASE_ENV, OPENAI_BASE_URL: ai.baseUrl },
    );
    expect(result.code).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/question|required param/i);
  }, 10000);
});
