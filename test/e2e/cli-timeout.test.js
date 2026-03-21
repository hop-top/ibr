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
import { describe, it, expect } from 'vitest';

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
  it.skip(
    'EXECUTION_TIMEOUT_MS=1000 + slow-page.html (3 s delay) → exit 1 — ' +
    'EXECUTION_TIMEOUT_MS not yet implemented in src/index.js',
    async () => {
      // slow-page.html delivers its dynamic content after 3 s;
      // 1000 ms global timeout should fire first.
      const result = await runIbr(
        ['go to http://127.0.0.1:PORT/slow-page.html and extract dynamic content'],
        {
          OPENAI_API_KEY: 'test-key',
          BROWSER_HEADLESS: 'true',
          BROWSER_SLOWMO: '0',
          CACHE_ENABLED: 'false',
          INSTRUCTION_EXECUTION_DELAY_MS: '0',
          INSTRUCTION_EXECUTION_JITTER_MS: '0',
          PAGE_LOADING_DELAY_MS: '0',
          LOG_LEVEL: 'error',
          EXECUTION_TIMEOUT_MS: '1000',
        },
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/TIMEOUT/);
    },
    10000,
  );

  it.skip(
    'stderr contains JSON error with code: "TIMEOUT" — ' +
    'EXECUTION_TIMEOUT_MS not yet implemented in src/index.js',
    async () => {
      const result = await runIbr(
        ['go to http://127.0.0.1:PORT/slow-page.html and extract dynamic content'],
        {
          OPENAI_API_KEY: 'test-key',
          BROWSER_HEADLESS: 'true',
          EXECUTION_TIMEOUT_MS: '1000',
          LOG_LEVEL: 'error',
        },
      );
      // stderr should contain JSON with { error: '...', code: 'TIMEOUT' }
      const lines = result.stderr.split('\n').filter(Boolean);
      const jsonLine = lines.find(l => {
        try { return JSON.parse(l).code === 'TIMEOUT'; } catch { return false; }
      });
      expect(jsonLine).toBeDefined();
    },
    10000,
  );

  it.skip(
    'BROWSER_TIMEOUT (per-element wait) does not trigger the global timeout — ' +
    'EXECUTION_TIMEOUT_MS not yet implemented in src/index.js',
    async () => {
      // With a generous EXECUTION_TIMEOUT_MS and a tight BROWSER_TIMEOUT,
      // the run may fail with an element-not-found error but NOT a TIMEOUT code.
      const result = await runIbr(
        ['go to http://127.0.0.1:PORT/slow-page.html and extract dynamic content'],
        {
          OPENAI_API_KEY: 'test-key',
          BROWSER_HEADLESS: 'true',
          BROWSER_TIMEOUT: '500',
          EXECUTION_TIMEOUT_MS: '30000',
          LOG_LEVEL: 'error',
        },
      );
      expect(result.stderr).not.toMatch(/"code"\s*:\s*"TIMEOUT"/);
    },
    15000,
  );
});
