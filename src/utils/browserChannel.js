/**
 * Browser channel resolution for Playwright — BACK-COMPAT SHIM.
 *
 * As of T-0025 the real implementation lives in src/browser/resolver.js
 * (the new browser-manager subsystem). This file remains as a thin shim
 * so any callers still using `resolveBrowserChannel()` keep working with
 * the legacy `{ channel?, executablePath? }` return shape.
 *
 * New code should call `resolveBrowser()` from `src/browser/index.js`
 * instead, which yields a full BrowserHandle.
 *
 * Track: adopt-lightpanda
 */

import { resolveProbeOnly } from '../browser/resolver.js';

/**
 * Resolve a BROWSER_CHANNEL value to legacy Playwright launch options.
 *
 * @param {string|undefined} channelRaw  Value of BROWSER_CHANNEL env var.
 * @returns {{ channel?: string, executablePath?: string }}
 *   Empty object when channelRaw is falsy (use Playwright's bundled Chromium).
 *   Throws if channel is specified but no executable can be found.
 */
export function resolveBrowserChannel(channelRaw) {
  return resolveProbeOnly(channelRaw);
}
