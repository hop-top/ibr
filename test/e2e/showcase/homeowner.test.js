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
  BROWSER_TIMEOUT: '20000',
  CACHE_ENABLED: 'false',
  LOG_LEVEL: 'info',
  OPENAI_API_KEY: 'test-key',
  XRR_MODE: 'passthrough',
};

describe('Showcase: Homeowner Personas', () => {
  let ai;
  let testTmpDir, augmentationsFile;

  beforeEach(async () => {
    testTmpDir = path.join(os.tmpdir(), `ibr-showcase-home-${Date.now()}`);
    augmentationsFile = path.join(testTmpDir, 'augmentations.json');
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  it('063: Local News Archival (archive.org)', async () => {
    // We use a real-world URL (miniflux.app) to archive on archive.org
    ai = await startFromCassette('showcase-063-archive-org');
    
    const store = {
      version: 1,
      rules: [
        {
          id: 'cleanup-archive-ui',
          urlPattern: '.*web\\.archive\\.org/save.*',
          domMutations: { remove: ['#don-reg', '.banner'] }
        }
      ]
    };
    await fs.writeFile(augmentationsFile, JSON.stringify(store));

    const prompt = `
url: https://web.archive.org/save
instructions:
  - fill "URL to save" with "https://miniflux.app/blog"
  - click "SAVE PAGE"
    `;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_AUGMENTATIONS_FILE: augmentationsFile,
      }
    );

    if (result.code !== 0) {
      console.error('IBR FAILED in REPLAY mode:');
      console.error('STDOUT:', result.stdout);
      console.error('STDERR:', result.stderr);
    }

    await ai.close();

    expect(result.code).toBe(0);
  }, 90000);

  it('064: Feed-based Insight Extraction (miniflux.app)', async () => {
    ai = await startFromCassette('showcase-064-miniflux');
    
    const store = {
      version: 1,
      rules: [
        {
          id: 'isolate-miniflux-blog',
          urlPattern: '.*miniflux\\.app/blog.*',
          domMutations: { isolate: ['main'] }
        }
      ]
    };
    await fs.writeFile(augmentationsFile, JSON.stringify(store));

    const prompt = `
url: https://miniflux.app/blog
instructions:
  - extract the titles and dates of the first 3 articles
  - for each article, extract the first paragraph of the description
    `;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_AUGMENTATIONS_FILE: augmentationsFile,
      }
    );

    if (result.code !== 0) {
      console.error('IBR FAILED in REPLAY mode:');
      console.error('STDOUT:', result.stdout);
      console.error('STDERR:', result.stderr);
    }

    await ai.close();

    expect(result.code).toBe(0);
  }, 90000);

  it('065: Historical Property Research (archive.org)', async () => {
    ai = await startFromCassette('showcase-065-historical');
    
    const prompt = `
url: https://web.archive.org/web/20220101000000*/https://miniflux.app/blog
instructions:
  - click the first snapshot from January 2022
  - extract the main headline
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
