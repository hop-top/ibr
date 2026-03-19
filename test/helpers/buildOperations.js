import { chromium } from 'playwright';
import { Operations } from '../../src/Operations.js';

const DEFAULT_AI_PROVIDER = {
  modelInstance: {},
  provider: 'openai',
  model: 'test',
};

/**
 * Build a real Playwright browser+page + mocked AI provider + Operations instance.
 *
 * @param {string} fixtureUrl - URL to navigate to before returning
 * @param {Object} options
 * @param {Object} [options.aiProvider] - Override default fake AI provider
 * @returns {Promise<{ operations: Operations, page: import('playwright').Page,
 *   browser: import('playwright').Browser, cleanup: () => Promise<void> }>}
 */
export async function buildOperations(fixtureUrl, options = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(fixtureUrl);

  const aiProvider = options.aiProvider ?? DEFAULT_AI_PROVIDER;
  const operations = new Operations({ aiProvider, page });

  async function cleanup() {
    await page.close();
    await browser.close();
  }

  return { operations, page, browser, cleanup };
}
