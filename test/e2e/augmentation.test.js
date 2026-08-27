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

  it('should bypass augmentations with --ignore-augmentations flag', async () => {
    ai = await makeAugmentationAi(web.baseUrl);

    const store = {
      version: 1,
      rules: [{ id: 'test', urlPattern: '.*', domMutations: { remove: ['body'] } }]
    };
    await fs.writeFile(augmentationsFile, JSON.stringify(store));

    const prompt = `url: ${web.baseUrl}/product-page.html\ninstructions:\n - extract price`;

    const result = await runIbr(
      ['--ignore-augmentations', prompt],
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

  it('should execute evaluateBeforeSnapshot script in the browser before snapshot', async () => {
    // Prove the augmentation `scripting.evaluateBeforeSnapshot` string is
    // actually eval'd in the page context — not merely that the rule matched.
    //
    // The rule carries NO domMutations, ONLY a script that removes the
    // full-screen .modal overlay from paywall-a.html. If the script runs,
    // the overlay is gone before the AI snapshot and the click on #target
    // lands directly. If it did NOT run, the fixed z-index:9999 modal
    // intercepts the click, the action fails, and Heal Mode is entered.
    // Asserting Heal Mode is NEVER entered pins in-browser script execution.
    ai = await startFakeAIServerE2E([
      JSON.stringify({
        url: `${web.baseUrl}/paywall-a.html`,
        instructions: [{ name: 'click', prompt: 'click #target' }],
      }),
      JSON.stringify({
        elements: [{ role: 'button', name: 'I am the content' }],
        type: 'click',
      }),
    ]);

    const store = {
      version: 1,
      rules: [
        {
          id: 'script-removes-modal',
          urlPattern: '.*paywall-a\\.html',
          scripting: {
            evaluateBeforeSnapshot:
              "document.querySelectorAll('.modal').forEach(el => el.remove());",
          },
        },
      ],
    };
    await fs.writeFile(augmentationsFile, JSON.stringify(store));

    const prompt = `url: ${web.baseUrl}/paywall-a.html\ninstructions:\n - click #target`;

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
    // Rule matched + augmentation block ran.
    expect(combined).toContain('Applying augmentations to page');
    expect(combined).toContain('script-removes-modal');
    // Script executed in-browser: modal removed → click succeeds directly,
    // so healing is never triggered.
    expect(combined).not.toContain('HealingService: initiating Heal Mode');
    expect(result.code).toBe(0);
  }, 30000);
});
