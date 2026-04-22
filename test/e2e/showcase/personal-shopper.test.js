import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { startFromCassette } from '../helpers/vcr.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

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
  BROWSER_TIMEOUT: '30000',
  CACHE_ENABLED: 'false',
  LOG_LEVEL: 'info',
  OPENAI_API_KEY: 'test-key',
  XRR_MODE: 'passthrough',
};

describe('Showcase: Personal Shopper Personas', () => {
  let ai;
  let testTmpDir, augmentationsFile;

  beforeEach(async () => {
    testTmpDir = path.join(os.tmpdir(), `ibr-showcase-shop-${Date.now()}`);
    augmentationsFile = path.join(testTmpDir, 'augmentations.json');
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  it('069: Global Price Comparison (eBay)', async () => {
    ai = await startFromCassette('showcase-069-ebay');
    
    const prompt = `
url: https://www.ebay.com/itm/335261546747
instructions:
  - extract the price
    `;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
      }
    );

    await ai.close();

    expect(result.code).toBe(0);
  }, 90000);

  it('070: Historical Value Research (archive.org)', async () => {
    ai = await startFromCassette('showcase-070-historical-shop');
    
    const prompt = `
url: https://web.archive.org/web/20210601000000/https://miniflux.app/pricing
instructions:
  - extract the price listed on the page
    `;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
      }
    );

    await ai.close();

    expect(result.code).toBe(0);
  }, 90000);

  it('071: Review Summary (amazon)', async () => {
    ai = await startFromCassette('showcase-071-amazon');
    
    const prompt = `
url: https://www.amazon.com/dp/B0CXBB82YP
instructions:
  - extract the product title
    `;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
      }
    );

    await ai.close();

    expect(result.code).toBe(0);
  }, 90000);
});
