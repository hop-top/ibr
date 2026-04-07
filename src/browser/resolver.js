/**
 * Browser resolution chain.
 *
 * Given an env, walk priority-ordered steps until one yields a resolution
 * record, then dispatch to the appropriate launcher.
 *
 * Chain order (see spec):
 *   1. BROWSER_EXECUTABLE_PATH → verbatim override
 *   2. BROWSER_CDP_URL (or deprecated LIGHTPANDA_WS) → connect-only
 *   3. local probe → system install
 *   4. managed cache → ~/.cache/ibr/browsers/<channel>/<version>/
 *   5. download → only if registry entry downloadable: true
 *
 * Each step returns null (try next) or a resolution record:
 *   { backend, source, version, executablePath?, wsEndpoint? }
 *
 * Sections:
 *   [SECTION: CHAIN]           — chain step dispatch (T-0025)
 *   [SECTION: LIFECYCLE_DISPATCH] — pick launcher kind → module (T-0030)
 *   [SECTION: EVENTS]          — NDJSON event emission (T-0025)
 *   [SECTION: PUBLIC_API]      — resolve() entry point
 *
 * Track: adopt-lightpanda
 */

import { canonicalizeChannel, getEntry, NATIVE_CHANNELS } from './registry.js';

// ── [SECTION: CHAIN] ─────────────────────────────────────────────────────────
// T-0025: implement step 1 (exec-path) and step 3 (local probe).
// T-0026: implement step 4 (cache) and step 5 (download).
// T-0030: implement step 2 (cdp-url) + dispatch.

// ── [SECTION: LIFECYCLE_DISPATCH] ────────────────────────────────────────────
// T-0030: given a resolution record + backend kind, pick the right launcher
// module and return a BrowserHandle.

// ── [SECTION: EVENTS] ────────────────────────────────────────────────────────
// NDJSON event emission helper. Writes JSON line to stderr matching ibr's
// existing agent contract. T-0025 populates.

// ── [SECTION: PUBLIC_API] ────────────────────────────────────────────────────

/**
 * Resolve env → BrowserHandle.
 *
 * @param {object} env
 * @param {object} [overrides]
 * @returns {Promise<import('./index.js').BrowserHandle>}
 */
export async function resolve(env, overrides = {}) {
  // TODO(T-0025): chain step 1 + 3
  // TODO(T-0026): chain step 4 + 5
  // TODO(T-0030): step 2 + lifecycle dispatch
  throw new Error('src/browser/resolver.js not yet implemented (adopt-lightpanda track)');
}
