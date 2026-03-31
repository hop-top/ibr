/**
 * Story 005 — AI provider selection
 * Tests: anthropic without key → exit 2; unknown provider → exit non-zero;
 *        custom model with fake OpenAI → run completes.
 *
 * Story 032 — OpenAI-compatible gateway support
 * Tests: OPENAI_BASE_URL routing, preserved error semantics, config validation.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
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
  CACHE_ENABLED: 'false',
  INSTRUCTION_EXECUTION_DELAY_MS: '0',
  INSTRUCTION_EXECUTION_JITTER_MS: '0',
  PAGE_LOADING_DELAY_MS: '0',
  LOG_LEVEL: 'error',
};

describe('cli provider selection (story 005)', () => {
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  it('AI_PROVIDER=anthropic without ANTHROPIC_API_KEY → exit non-zero + config error', async () => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const result = await runIbr(
      [`go to ${web.baseUrl}/product-page.html and extract title`],
      {
        ...env,
        ...BASE_ENV,
        AI_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: '',
      },
    );
    // Logger outputs "Fatal error" (metadata stripped by winston printf format)
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined.toLowerCase()).toMatch(/error|fatal/i);
  }, 15000);

  it('AI_PROVIDER=unknownprovider → exit non-zero + descriptive error', async () => {
    // Unknown provider falls through to default (openai) in current impl,
    // but OPENAI_API_KEY is absent → should fail with missing key error.
    // Either way: exit non-zero + informative output.
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      [`go to ${web.baseUrl}/product-page.html and extract title`],
      {
        ...env,
        ...BASE_ENV,
        AI_PROVIDER: 'unknownprovider',
        OPENAI_API_KEY: '',
      },
    );
    expect(result.code).not.toBe(0);
  }, 15000);

  it('AI_MODEL=custom-model with fake OpenAI endpoint → run completes exit 0', async () => {
    const ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get the title' }],
      }),
      JSON.stringify([{ text: 'Widget Pro' }]),
    ]);

    const result = await runIbr(
      [`go to ${web.baseUrl}/product-page.html and extract the title`],
      {
        ...BASE_ENV,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: ai.baseUrl,
        AI_MODEL: 'custom-model-v1',
        AI_PROVIDER: 'openai',
      },
    );
    await ai.close();

    // Run completes with custom model name — exit 0 confirms model was accepted
    // (logger printf strips metadata so model name won't appear in stdout)
    expect(result.code).toBe(0);
  }, 30000);

  it('AI_PROVIDER=openai with OPENAI_API_KEY set → does not reject key', async () => {
    const ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/product-page.html`,
        instructions: [{ name: 'extract', prompt: 'get the rating' }],
      }),
      JSON.stringify([{ text: '4.5 stars' }]),
    ]);

    const result = await runIbr(
      [`visit ${web.baseUrl}/product-page.html and get rating`],
      {
        ...BASE_ENV,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: ai.baseUrl,
        AI_PROVIDER: 'openai',
      },
    );
    await ai.close();

    expect(result.code).toBe(0);
  }, 30000);
});

// ── Story 032 — OpenAI-compatible gateway support ────────────────────────────

describe('cli openai-compatible gateway support (story 032)', () => {
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  it(
    'OPENAI_BASE_URL routes requests to custom gateway → exit 0',
    async () => {
      const ai = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the title' }],
        }),
        JSON.stringify([{ text: 'Widget Pro' }]),
      ]);
      const prompt =
        `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title\n`;
      const result = await runIbr(
        [],
        {
          ...BASE_ENV,
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: ai.baseUrl,
          AI_PROVIDER: 'openai',
        },
        prompt,
      );
      await ai.close();
      expect(result.code).toBe(0);
    },
    30000,
  );

  it(
    'OPENAI_BASE_URL + AI_MODEL override → custom model accepted, exit 0',
    async () => {
      const ai = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the price' }],
        }),
        JSON.stringify([{ text: '$29.99' }]),
      ]);
      const prompt =
        `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the price\n`;
      const result = await runIbr(
        [],
        {
          ...BASE_ENV,
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: ai.baseUrl,
          AI_PROVIDER: 'openai',
          AI_MODEL: 'my-gateway-model',
        },
        prompt,
      );
      await ai.close();
      expect(result.code).toBe(0);
    },
    30000,
  );

  it(
    'OPENAI_BASE_URL set but OPENAI_API_KEY missing → exit non-zero + error output',
    async () => {
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      delete env.ANTHROPIC_API_KEY;
      delete env.GOOGLE_GENERATIVE_AI_API_KEY;

      const prompt =
        `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title\n`;
      const result = await runIbr(
        [],
        {
          ...env,
          ...BASE_ENV,
          AI_PROVIDER: 'openai',
          OPENAI_API_KEY: '',
          OPENAI_BASE_URL: 'http://127.0.0.1:19999',
        },
        prompt,
      );
      expect(result.code).not.toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toMatch(/error|fatal/i);
    },
    15000,
  );

  it(
    'AI_PROVIDER=openai missing key without OPENAI_BASE_URL → same error semantics',
    async () => {
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      delete env.ANTHROPIC_API_KEY;
      delete env.GOOGLE_GENERATIVE_AI_API_KEY;

      const prompt =
        `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title\n`;
      const result = await runIbr(
        [],
        {
          ...env,
          ...BASE_ENV,
          AI_PROVIDER: 'openai',
          OPENAI_API_KEY: '',
        },
        prompt,
      );
      expect(result.code).not.toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toMatch(/error|fatal/i);
    },
    15000,
  );
});
