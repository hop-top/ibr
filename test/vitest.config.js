import { defineConfig } from 'vitest/config';
import { spawnSync } from 'node:child_process';

function detectBrowserSupport() {
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { chromium } from 'playwright';
       try {
         const browser = await chromium.launch({ headless: true });
         await browser.close();
         process.exit(0);
       } catch {
         process.exit(1);
       }`,
    ],
    {
      cwd: process.cwd(),
      stdio: 'ignore',
      timeout: 15000,
    },
  );

  return probe.status === 0;
}

const browserSupported = detectBrowserSupport();
const browserBackedExcludes = browserSupported
  ? []
  : ['test/e2e/**', 'test/integration/**', 'test/unit/helpers/buildOperations.test.js'];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 15000,
    pool: 'forks',
    env: {
      CACHE_ENABLED: 'false',
      INSTRUCTION_EXECUTION_DELAY_MS: '0',
      INSTRUCTION_EXECUTION_JITTER_MS: '0',
      PAGE_LOADING_DELAY_MS: '0',
      BROWSER_HEADLESS: 'true',
      BROWSER_SLOWMO: '0',
      BROWSER_TIMEOUT: '5000',
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      PLAYWRIGHT_BROWSER_TESTS: browserSupported ? 'true' : 'false',
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      ...browserBackedExcludes,
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/utils/logger.js'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 75 }
    }
  }
});
