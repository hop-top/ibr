/**
 * Story 034 — Tool lifecycle commands
 * Tests: version outputs and upgrade routing without browser or AI startup.
 *
 * All commands must complete without launching a browser or requiring an API key.
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

// No API key — lifecycle commands must not require one
const NO_KEY_ENV = {
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  GOOGLE_GENERATIVE_AI_API_KEY: '',
  LOG_LEVEL: 'error',
};

describe('cli lifecycle commands (story 034)', () => {
  it('ibr version → exits 0 with human-readable version string', async () => {
    const result = await runIbr(['version'], NO_KEY_ENV);
    expect(result.code).toBe(0);
    // Must contain "ibr" and a semver-like token
    expect(result.stdout).toMatch(/ibr/i);
    expect(result.stdout).toMatch(/\d+\.\d+/);
  }, 10000);

  it('ibr version --short → exits 0 with only the version number', async () => {
    const result = await runIbr(['version', '--short'], NO_KEY_ENV);
    expect(result.code).toBe(0);
    // Short output should be just a version string (no "ibr" prefix)
    const trimmed = result.stdout.trim();
    expect(trimmed).toMatch(/^\d+\.\d+/);
  }, 10000);

  it('ibr version --json → exits 0 with valid JSON including version field', async () => {
    const result = await runIbr(['version', '--json'], NO_KEY_ENV);
    expect(result.code).toBe(0);
    let parsed;
    expect(() => { parsed = JSON.parse(result.stdout); }).not.toThrow();
    expect(parsed).toHaveProperty('version');
    expect(typeof parsed.version).toBe('string');
    expect(parsed.version).toMatch(/\d+\.\d+/);
  }, 10000);

  it('ibr version --json includes node and platform fields', async () => {
    const result = await runIbr(['version', '--json'], NO_KEY_ENV);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('node');
    expect(parsed).toHaveProperty('platform');
  }, 10000);

  it('ibr version does not start browser or request API key', async () => {
    const result = await runIbr(['version'], NO_KEY_ENV);
    expect(result.code).toBe(0);
    // No browser launch messages, no API key errors
    const combined = result.stdout + result.stderr;
    expect(combined).not.toMatch(/api.?key/i);
    expect(combined).not.toMatch(/chromium|playwright/i);
  }, 10000);

  it(
    'ibr upgrade preamble → exits 0 and emits preamble fragment without browser/AI',
    async () => {
      const result = await runIbr(['upgrade', 'preamble'], NO_KEY_ENV);
      expect(result.code).toBe(0);
      // Preamble output should be non-empty text
      expect(result.stdout.length).toBeGreaterThan(0);
      // No browser or API key activity
      const combined = result.stdout + result.stderr;
      expect(combined).not.toMatch(/chromium|playwright/i);
    },
    15000,
  );

  it(
    'ibr upgrade routes into upgrade flow without browser startup → exits 0 or non-zero (no crash)',
    async () => {
      // upgrade may check for newer versions online; in CI/offline it may fail
      // gracefully. The key requirement: no browser launched, no AI key needed.
      const result = await runIbr(['upgrade', '--quiet'], NO_KEY_ENV);
      // Exit code is not asserted (network-dependent), but must not crash with unhandled error
      const combined = result.stdout + result.stderr;
      // Must not have tried to launch chromium
      expect(combined).not.toMatch(/chromium|playwright/i);
      // Must not have complained about missing API key
      expect(combined).not.toMatch(/openai_api_key|anthropic_api_key/i);
    },
    20000,
  );
});
