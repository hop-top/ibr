import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { startFromCassette } from './helpers/vcr.js';

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
  LOG_LEVEL: 'info',
  OPENAI_API_KEY: 'test-key',
  XRR_MODE: 'passthrough',
  PAGE_LOADING_DELAY_MS: '0',
  INSTRUCTION_EXECUTION_DELAY_MS: '0',
};

describe('E2E — Infrastructure Fallback & Routing', () => {
  let ai;
  let testTmpDir, infraConfig;

  beforeEach(async () => {
    testTmpDir = path.join(os.tmpdir(), `ibr-e2e-infra-${Date.now()}`);
    infraConfig = path.join(testTmpDir, 'infra.json');
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  it('should use proactive cloud routing based on URL pattern', async () => {
    ai = await startFromCassette('showcase-072-routing');
    
    const config = {
      providers: {
        'browser-use': {
          accounts: [{ name: 'test', key: 'test-key' }]
        }
      },
      routing: {
        default: 'local',
        policies: [
          {
            urlPattern: 'google\\.com',
            providers: ['browser-use'],
            stage: 'proactive'
          }
        ]
      }
    };
    await fs.writeFile(infraConfig, JSON.stringify(config));

    const prompt = `url: https://www.google.com\ninstructions:\n - extract title`;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_INFRA_CONFIG: infraConfig,
        TARGET_URL: 'https://www.google.com' // Trigger proactive routing manually for this test
      }
    );

    await ai.close();

    const combined = result.stdout + result.stderr;
    // The logs (via browser.resolved event) should show infra-policy source
    expect(combined).toContain('"source":"infra-policy"');
    expect(combined).toContain('"channel":"browser-use"');
  }, 30000);

  it('should resolve pod provider correctly', async () => {
    ai = await startFromCassette('showcase-073-pod-routing');
    
    const config = {
      providers: {
        'pod': {
          accounts: [{ name: 'my-gpu-pod', key: 'ssh://pod-123' }]
        }
      },
      routing: {
        default: 'local',
        policies: [
          {
            urlPattern: 'gpu-heavy\\.com',
            providers: ['pod'],
            stage: 'proactive'
          }
        ]
      }
    };
    await fs.writeFile(infraConfig, JSON.stringify(config));

    const prompt = `url: https://gpu-heavy.com\ninstructions:\n - extract stats`;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_INFRA_CONFIG: infraConfig,
        TARGET_URL: 'https://gpu-heavy.com'
      }
    );

    await ai.close();

    const combined = result.stdout + result.stderr;
    expect(combined).toContain('"source":"infra-policy"');
    expect(combined).toContain('"channel":"pod"');
    expect(combined).toContain('"wsEndpoint":"ssh://pod-123"');
  }, 30000);

  it('should resolve browserless provider correctly', async () => {
    ai = await startFromCassette('showcase-074-browserless-routing');
    
    const config = {
      providers: {
        'browserless': {
          accounts: [{ name: 'test-bl', key: 'bl-token' }]
        }
      },
      routing: {
        default: 'local',
        policies: [
          {
            urlPattern: 'scrape-me\\.com',
            providers: ['browserless'],
            stage: 'proactive'
          }
        ]
      }
    };
    await fs.writeFile(infraConfig, JSON.stringify(config));

    const prompt = `url: https://scrape-me.com\ninstructions:\n - extract title`;

    const result = await runIbr(
      [prompt],
      { 
        ...TEST_ENV, 
        OPENAI_BASE_URL: ai.baseUrl,
        IBR_INFRA_CONFIG: infraConfig,
        TARGET_URL: 'https://scrape-me.com'
      }
    );

    await ai.close();

    const combined = result.stdout + result.stderr;
    expect(combined).toContain('"source":"infra-policy"');
    expect(combined).toContain('"channel":"browserless"');
    expect(combined).toContain('"wsEndpoint":"wss://chrome.browserless.io?token=bl-token"');
  }, 30000);
});
