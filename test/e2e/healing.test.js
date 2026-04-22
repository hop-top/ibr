import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { startFromCassette } from './helpers/vcr.js';
import { startStaticServer } from '../helpers/staticServer.js';
import logger from '../../src/utils/logger.js';

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
  BROWSER_TIMEOUT: '5000',
  LOG_LEVEL: 'info',
  OPENAI_API_KEY: 'test-key',
  XRR_MODE: 'passthrough',
};

describe('E2E — Self-Healing', () => {
  let web, ai;
  let testTmpDir, augmentationsFile, learningsFile;

  beforeAll(async () => {
    web = await startStaticServer();
  }, 15000);

  afterAll(async () => {
    await web.close();
  });

  beforeEach(async () => {
    testTmpDir = path.join(os.tmpdir(), `ibr-e2e-heal-${Date.now()}`);
    augmentationsFile = path.join(testTmpDir, 'augmentations.json');
    learningsFile = path.join(testTmpDir, 'learnings.json');
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  it('should trigger Heal Mode and use learnings for intuition', async () => {
    // Sequence:
    // 1. Site A: Parse, Click Fail, Heal, Click Success
    // 2. Site B: Parse, Click Fail, Heal (guided by A), Click Success
    ai = await startFromCassette('healing-intuition-test', { SERVER_URL: web.baseUrl });

    const env = { 
      ...TEST_ENV, 
      IBR_AUGMENTATIONS_FILE: augmentationsFile,
      IBR_LEARNINGS_FILE: learningsFile,
      OPENAI_BASE_URL: ai.baseUrl,
    };

    // --- Site A ---
    const resultA = await runIbr([`url: ${web.baseUrl}/paywall-a.html\ninstructions:\n - click #target`], env);
    const combinedA = resultA.stdout + resultA.stderr;
    expect(combinedA).toContain('HealingService: initiating Heal Mode');
    expect(combinedA).toContain('HealingService: found successful fix');
    expect(resultA.code).toBe(0);

    // Verify learning was saved
    const learnings = JSON.parse(await fs.readFile(learningsFile, 'utf8'));
    expect(Object.keys(learnings).length).toBe(1);
    
    // --- Site B ---
    const resultB = await runIbr([`url: ${web.baseUrl}/paywall-b.html\ninstructions:\n - click #target`], env);
    const combinedB = resultB.stdout + resultB.stderr;
    expect(combinedB).toContain('HealingService: initiating Heal Mode');
    expect(combinedB).toContain('HealingService: found successful fix');
    expect(resultB.code).toBe(0);

    await ai.close();

    // Verify learningsFile has both (or updated)
    const finalLearnings = JSON.parse(await fs.readFile(learningsFile, 'utf8'));
    expect(Object.keys(finalLearnings).length).toBeGreaterThan(0);
  }, 120000);
});
