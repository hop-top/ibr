import { defineConfig } from 'vitest/config';

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
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/utils/logger.js'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80, functions: 80, branches: 75 }
    }
  }
});
