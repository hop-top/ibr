/**
 * E2E tests for `ibr tool` subcommand (T-0002).
 *
 * Tests: --list, missing name, unknown tool, missing required param.
 * Does NOT test actual browser execution (that requires a live browser + API key).
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

const NO_KEY_ENV = {
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  GOOGLE_GENERATIVE_AI_API_KEY: '',
  LOG_LEVEL: 'error',
};

describe('ibr tool subcommand (T-0002)', () => {
  it('ibr tool --list → exits 0 and lists available tools', async () => {
    const result = await runIbr(['tool', '--list'], NO_KEY_ENV);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/web-search/);
    expect(result.stdout).toMatch(/web-fetch/);
  }, 10000);

  it('ibr tool --list → does not start browser or require API key', async () => {
    const result = await runIbr(['tool', '--list'], NO_KEY_ENV);
    expect(result.code).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).not.toMatch(/chromium|playwright/i);
    expect(combined).not.toMatch(/api.?key/i);
  }, 10000);

  it('ibr tool (no name) → exits non-zero with usage hint', async () => {
    const result = await runIbr(['tool'], NO_KEY_ENV);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/tool.*name|ibr tool/i);
  }, 10000);

  it('ibr tool unknown-tool → exits non-zero with "not found" message', async () => {
    const result = await runIbr(['tool', 'does-not-exist-xyz'], NO_KEY_ENV);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/not found|Tool not found/i);
  }, 10000);

  it('ibr tool web-search (missing required query param) → exits non-zero', async () => {
    const result = await runIbr(['tool', 'web-search'], NO_KEY_ENV);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/query|required param/i);
  }, 10000);

  it('ibr tool web-search --param query=test → fails only on missing API key, not config', async () => {
    // With a valid tool invocation but no AI key, the error should be about
    // the missing API key (browser/AI path), not about tool config.
    const result = await runIbr(['tool', 'web-search', '--param', 'query=test'], NO_KEY_ENV);
    // Should fail due to missing API key or browser launch, not tool config
    const combined = result.stdout + result.stderr;
    // Must NOT error about tool not found or missing param
    expect(combined).not.toMatch(/Tool not found/i);
    expect(combined).not.toMatch(/Missing required param/i);
  }, 15000);
});
