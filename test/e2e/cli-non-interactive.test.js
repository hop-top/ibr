/**
 * Story 016 — Non-interactive / stdin usage
 * Tests: prompt via stdin → exit 0; missing API key + no TTY → exit non-zero
 *        with error on stderr, no readline prompt.
 *
 * Story 033 — CLI composition via stdin
 * Tests: multiline stdin prompts, argv precedence over stdin, no-input failure.
 *
 * NOTE: src/index.js currently reads the prompt from process.argv[2] only.
 * stdin piping tests are marked skip until stdin support is implemented.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFromCassette } from './helpers/vcr.js';
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

describe('cli non-interactive mode (story 016)', () => {
  let ai;
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
    ai = await startFromCassette('story-016-stdin', { SERVER_URL: web.baseUrl });
  }, 15000);

  afterAll(async () => {
    await ai.close();
    await web.close();
  });

  it(
    'prompt piped via stdin (no CLI arg) → exit 0',
    async () => {
      const prompt =
        `go to ${web.baseUrl}/product-page.html and extract the title\n`;
      const result = await runIbr(
        [],
        {
          ...BASE_ENV,
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: ai.baseUrl,
        },
        prompt,
      );
      expect(result.code).toBe(0);
    },
  );

  it('exits non-zero with error output when API key missing (no TTY)', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;

    const result = await runIbr(
      ['go to example.com and extract title'],
      {
        ...env,
        ...BASE_ENV,
        OPENAI_API_KEY: '',
      },
    );
    // Logger outputs "Fatal error" (metadata stripped by winston printf format)
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined.toLowerCase()).toMatch(/error|fatal/i);
  }, 15000);

  it('does not emit readline prompt characters when stdin is not a TTY', async () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;

    const result = await runIbr(
      ['some prompt'],
      {
        ...env,
        ...BASE_ENV,
        OPENAI_API_KEY: '',
      },
    );
    // readline prompt char '>' or '?' would indicate interactive mode leaking
    expect(result.stdout).not.toMatch(/^[>?]\s/m);
  }, 15000);

  it('normal argv run still exits 0 with fake AI (sanity check)', async () => {
    const ai2 = await startFromCassette('story-016-argv-sanity', { SERVER_URL: web.baseUrl });
    const result = await runIbr(
      [`visit ${web.baseUrl}/product-page.html and get rating`],
      {
        ...BASE_ENV,
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: ai2.baseUrl,
      },
    );
    await ai2.close();
    expect(result.code).toBe(0);
  }, 30000);
});

// ── Story 033 — CLI composition via stdin ────────────────────────────────────

describe('cli composition via stdin (story 033)', () => {
  let web;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  it(
    'multiline stdin prompt accepted intact → exit 0',
    async () => {
      const ai = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the title' }],
        }),
        JSON.stringify([{ text: 'Widget Pro' }]),
      ]);
      // Multiline YAML-style prompt piped via stdin
      const prompt = [
        `url: ${web.baseUrl}/product-page.html`,
        'instructions:',
        '  - extract the title',
        '',
      ].join('\n');
      const result = await runIbr(
        [],
        {
          ...BASE_ENV,
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: ai.baseUrl,
        },
        prompt,
      );
      await ai.close();
      expect(result.code).toBe(0);
    },
    30000,
  );

  it(
    'argv prompt takes precedence over stdin → argv prompt is used',
    async () => {
      const ai = await startFakeAIServerE2E([
        JSON.stringify({
          url: `${web.baseUrl}/product-page.html`,
          instructions: [{ name: 'extract', prompt: 'get the title' }],
        }),
        JSON.stringify([{ text: 'Widget Pro' }]),
      ]);
      // Argv prompt (with url:) wins over stdin content
      const argvPrompt =
        `url: ${web.baseUrl}/product-page.html\ninstructions:\n  - extract the title`;
      // Stdin prompt is deliberately invalid (no url:) to confirm it's ignored
      const stdinPrompt = 'this is a different prompt with no url field\n';
      const result = await runIbr(
        [argvPrompt],
        {
          ...BASE_ENV,
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: ai.baseUrl,
        },
        stdinPrompt,
      );
      await ai.close();
      // If argv wins, the url: prompt is used and the run succeeds
      expect(result.code).toBe(0);
    },
    30000,
  );

  it(
    'no argv and no stdin → exit non-zero with descriptive error',
    async () => {
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;
      // Send empty stdin to simulate EOF without content
      const result = await runIbr(
        [],
        {
          ...env,
          ...BASE_ENV,
          OPENAI_API_KEY: 'test-key',
          OPENAI_BASE_URL: 'http://127.0.0.1:19998',
        },
        '', // empty stdin
      );
      expect(result.code).not.toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toMatch(/error|fatal|prompt/i);
    },
    15000,
  );
});
