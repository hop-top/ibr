/**
 * Browser manager — public API.
 *
 * Single entry point for all ibr call sites that need a browser.
 * Replaces direct `chromium.launch()` calls scattered through the codebase.
 *
 * Track: adopt-lightpanda
 * Spec: .tlc/tracks/adopt-lightpanda/spec.md
 */

import { resolve } from './resolver.js';

/**
 * Resolve a browser per current env + overrides, return a BrowserHandle.
 *
 * @param {object} env        - Usually process.env; can be a subset for tests
 * @param {object} [overrides] - Additional Playwright launchOptions / contextOptions
 * @returns {Promise<BrowserHandle>}
 *
 * @typedef {object} BrowserHandle
 * @property {import('playwright').Browser} browser
 * @property {import('playwright').BrowserContext} context
 * @property {() => Promise<void>} close
 */
export async function resolveBrowser(env, overrides = {}) {
  return resolve(env, overrides);
}
