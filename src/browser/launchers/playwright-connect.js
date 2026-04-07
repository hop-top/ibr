/**
 * Playwright connectOverCDP launcher — used for all `cdp-server` backends.
 *
 * Lightpanda is the first tenant. Any browser exposing a CDP websocket
 * endpoint can use this launcher.
 *
 * close() disconnects but does NOT kill the remote process. Process
 * ownership stays with whoever spawned it (user, daemon, or one-shot
 * ibr wrapper — managed by lifecycle dispatch in resolver.js).
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0028
 */

import { chromium } from 'playwright';

/**
 * Validate a CDP websocket endpoint string.
 * Exported for tests only — do not depend on it from other modules.
 *
 * @param {unknown} s
 * @returns {boolean}
 */
export function _isValidWsEndpoint(s) {
  if (!s || typeof s !== 'string') return false;
  return s.startsWith('ws://') || s.startsWith('wss://');
}

/**
 * Emit an NDJSON event to stderr. Local helper — intentionally not
 * shared with resolver.js (T-0025 scope).
 *
 * @param {object} obj
 */
function emitEvent(obj) {
  try {
    process.stderr.write(JSON.stringify(obj) + '\n');
  } catch {
    // Best-effort: never throw from telemetry.
  }
}

/**
 * Connect to a remote CDP endpoint and return a BrowserHandle.
 *
 * Reuses the first existing context if the remote already has one
 * (common with persistent CDP servers like lightpanda); otherwise
 * creates a new context with `contextOptions`.
 *
 * close() calls browser.close() — for a CDP-connected browser this
 * disconnects the websocket WITHOUT killing the remote process.
 * This is the critical semantic difference from chromium.launch().
 *
 * @param {object} args
 * @param {string} args.wsEndpoint - ws:// or wss:// CDP endpoint
 * @param {object} [args.contextOptions] - passed to newContext() if no
 *   existing context is found
 * @returns {Promise<{
 *   browser: import('playwright').Browser,
 *   context: import('playwright').BrowserContext,
 *   close: () => Promise<void>
 * }>}
 */
export async function connect({ wsEndpoint, contextOptions = {} }) {
  if (!_isValidWsEndpoint(wsEndpoint)) {
    throw new Error(
      `playwright-connect: invalid wsEndpoint (expected ws:// or wss:// URL, got: ${
        wsEndpoint === undefined ? 'undefined' : JSON.stringify(wsEndpoint)
      })`
    );
  }

  const browser = await chromium.connectOverCDP(wsEndpoint);

  const existing = browser.contexts();
  const contextsOnConnect = existing.length;
  let context;
  let reusedContext;
  if (contextsOnConnect > 0) {
    context = existing[0];
    reusedContext = true;
  } else {
    context = await browser.newContext(contextOptions);
    reusedContext = false;
  }

  emitEvent({
    event: 'browser.connected',
    wsEndpoint,
    reusedContext,
    contextsOnConnect
  });

  return {
    browser,
    context,
    close: async () => {
      await browser.close();
    }
  };
}
