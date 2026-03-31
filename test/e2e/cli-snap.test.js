/**
 * Story 027 — Inspect Before Automating
 * Tests: snap runs without AI config, outputs DOM and ARIA views,
 *        supports -i filtering, emits annotated screenshot paths with -a
 */
import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const SNAP_ENV = {
  BROWSER_HEADLESS: 'true',
  BROWSER_SLOWMO: '0',
  BROWSER_TIMEOUT: '10000',
  LOG_LEVEL: 'error',
  // No AI keys — snap must work without them
  OPENAI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  GOOGLE_GENERATIVE_AI_API_KEY: '',
};

describe('cli snap (story 027)', () => {
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  it('snap runs without any AI provider config (exit 0)', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      ['snap', `${web.baseUrl}/product-page.html`],
      { ...env, ...SNAP_ENV },
    );
    expect(result.code).toBe(0);
  }, 30000);

  it('default snap outputs DOM Tree header (=== DOM Tree ===)', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      ['snap', `${web.baseUrl}/product-page.html`],
      { ...env, ...SNAP_ENV },
    );
    expect(result.stdout).toContain('=== DOM Tree ===');
  }, 30000);

  it('snap --aria outputs ARIA Snapshot header (=== ARIA Snapshot ===)', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      ['snap', '--aria', `${web.baseUrl}/product-page.html`],
      { ...env, ...SNAP_ENV },
    );
    expect(result.stdout).toContain('=== ARIA Snapshot ===');
  }, 30000);

  it('snap --aria does NOT output DOM Tree header', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      ['snap', '--aria', `${web.baseUrl}/product-page.html`],
      { ...env, ...SNAP_ENV },
    );
    expect(result.stdout).not.toContain('=== DOM Tree ===');
  }, 30000);

  it('snap -i (interactive filter) exits 0 and still outputs DOM header', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      ['snap', '-i', `${web.baseUrl}/search-form.html`],
      { ...env, ...SNAP_ENV },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('=== DOM Tree ===');
  }, 30000);

  it('snap -a writes annotated screenshot and prints path to stderr', async () => {
    const annotatedPath = '/tmp/ibr-dom-annotated.png';
    // Clean up before test
    try { unlinkSync(annotatedPath); } catch { /* ignore */ }

    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      ['snap', '-a', `${web.baseUrl}/product-page.html`],
      { ...env, ...SNAP_ENV },
    );
    expect(result.code).toBe(0);
    // Path emitted to stderr
    expect(result.stderr).toContain(annotatedPath);
    // File actually created
    expect(existsSync(annotatedPath)).toBe(true);

    // Cleanup
    try { unlinkSync(annotatedPath); } catch { /* ignore */ }
  }, 30000);

  it('snap without API keys does NOT emit an API key error', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      ['snap', `${web.baseUrl}/product-page.html`],
      { ...env, ...SNAP_ENV },
    );
    const combined = result.stdout + result.stderr;
    expect(combined).not.toMatch(/api.?key/i);
  }, 30000);
});
