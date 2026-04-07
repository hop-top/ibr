/**
 * Playwright launch() launcher — existing codepath, lightly refactored.
 *
 * Used for all `chromium-launch` kind backends:
 *   chrome, msedge, brave, chromium, arc, comet
 *
 * Returns BrowserHandle with close() that kills the Chromium subprocess
 * (Playwright default behavior).
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0025
 */

import { chromium } from 'playwright';

/**
 * Launch a Chromium-family browser via Playwright's chromium.launch().
 *
 * @param {object}   args
 * @param {string}  [args.executablePath] - Direct path override
 * @param {string}  [args.channel]        - Playwright-native channel name
 * @param {object}  [args.launchOptions]  - Other options merged into launch()
 * @returns {Promise<{browser: import('playwright').Browser, context: null, close: () => Promise<void>}>}
 */
export async function launch({ executablePath, channel, launchOptions = {} } = {}) {
  const opts = { ...launchOptions };
  if (executablePath) opts.executablePath = executablePath;
  if (channel) opts.channel = channel;

  const browser = await chromium.launch(opts);

  return {
    browser,
    context: null,
    close: async () => {
      try { await browser.close(); } catch { /* already closed */ }
    },
  };
}
