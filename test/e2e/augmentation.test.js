import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { startStaticServer } from '../helpers/staticServer.js';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';

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

const TEST_ENV = {
  BROWSER_HEADLESS: 'true',
  BROWSER_SLOWMO: '0',
  BROWSER_TIMEOUT: '10000',
  CACHE_ENABLED: 'false',
  LOG_LEVEL: 'info',
  OPENAI_API_KEY: 'test-key',
  XRR_MODE: 'passthrough', // Use passthrough for XRR so it uses OPENAI_BASE_URL (the fake server)
};

function makeAugmentationAi(baseUrl) {
  return startFakeAIServerE2E([
    JSON.stringify({
      url: `${baseUrl}/product-page.html`,
      instructions: [{ name: 'extract', prompt: 'price' }],
    }),
    JSON.stringify([{ price: '$19.99' }]),
  ]);
}

describe('E2E — Augmentations and Healing', () => {
  let web, ai;
  let testTmpDir, augmentationsFile;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  beforeEach(async () => {
    testTmpDir = path.join(os.tmpdir(), `ibr-e2e-aug-${Date.now()}`);
    augmentationsFile = path.join(testTmpDir, 'augmentations.json');
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  it('should apply augmentation rules from file', async () => {
    ai = await makeAugmentationAi(web.baseUrl);
    
    const store = {
      version: 1,
      rules: [
        {
          id: 'remove-price',
          urlPattern: '.*product-page\\.html',
          domMutations: { remove: ['.price'] }
        }
      ]
    };
    await fs.writeFile(augmentationsFile, JSON.stringify(store));

    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n - extract price`;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_AUGMENTATIONS_FILE: augmentationsFile,
      }
    );

    await ai.close();

    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Applying augmentations to page');
    expect(combined).toContain('remove-price');
    expect(result.code).toBe(0);
  }, 30000);

  it('should bypass augmentations with --raw flag', async () => {
    ai = await makeAugmentationAi(web.baseUrl);

    const store = {
      version: 1,
      rules: [{ id: 'test', urlPattern: '.*', domMutations: { remove: ['body'] } }]
    };
    await fs.writeFile(augmentationsFile, JSON.stringify(store));

    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n - extract price`;

    const result = await runIbr(
      ['--raw', prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_AUGMENTATIONS_FILE: augmentationsFile,
      }
    );

    await ai.close();

    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain('Applying augmentations to page');
    expect(result.code).toBe(0);
  }, 30000);
});
