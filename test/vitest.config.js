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
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
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
