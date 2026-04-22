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

describe('Showcase: Business Manager Personas', () => {
  let ai;
  let testTmpDir, augmentationsFile;

  beforeEach(async () => {
    testTmpDir = path.join(os.tmpdir(), `ibr-showcase-biz-${Date.now()}`);
    augmentationsFile = path.join(testTmpDir, 'augmentations.json');
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  it('066: Competitor Pricing Audit (archive.org vs live)', async () => {
    ai = await startFromCassette('showcase-066-pricing-audit');
    
    const prompt = `
url: https://web.archive.org/web/20231001000000/https://miniflux.app/pricing
instructions:
  - extract all pricing plan names
  - navigate to https://miniflux.app/pricing
  - extract current pricing plan names
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

  it('067: OSS Contributor Enrichment (GitHub)', async () => {
    ai = await startFromCassette('showcase-067-github-contributors');
    
    const prompt = `
url: https://github.com/microsoft/playwright
instructions:
  - extract the number of stars
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

  it('068: ArXiv AI Research Feed (arxiv tool)', async () => {
    ai = await startFromCassette('showcase-068-arxiv-tool');
    
    const result = await runIbr(
      ['tool', 'arxiv', '--param', 'query=cat:cs.AI AND browser agents', '--param', 'count=2'],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
      }
    );

    await ai.close();

    expect(result.code).toBe(0);
  }, 90000);
});
