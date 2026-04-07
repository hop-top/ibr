/**
 * Browser registry — single source of truth for all browsers ibr knows about.
 *
 * Each entry describes:
 *   - id, aliases, kind (chromium-launch | cdp-server | native-channel)
 *   - localProbe paths (existing EXEC_CANDIDATES behavior)
 *   - downloadable + release provider config (for managed browsers)
 *   - launcher module name + spawner module name (if any)
 *
 * Sections:
 *   [SECTION: NATIVE_CHANNELS]  — Playwright-native passthrough names
 *   [SECTION: ALIASES]          — user-friendly name normalization
 *   [SECTION: ENTRIES]          — full registry entries (edit this section)
 *   [SECTION: PUBLIC_API]       — lookup helpers
 *
 * Track: adopt-lightpanda
 */

import os from 'os';
import path from 'path';

// ── [SECTION: NATIVE_CHANNELS] ───────────────────────────────────────────────
// Playwright resolves these natively via `channel:` — no executablePath probe.
export const NATIVE_CHANNELS = new Set([
  'chrome', 'chrome-beta', 'chrome-dev', 'chrome-canary',
  'msedge', 'msedge-beta', 'msedge-dev', 'msedge-canary',
]);

// ── [SECTION: ALIASES] ───────────────────────────────────────────────────────
export const ALIASES = {
  'google-chrome': 'chrome',
  'google chrome': 'chrome',
  'edge': 'msedge',
  'microsoft-edge': 'msedge',
  'microsoft edge': 'msedge',
  'panda': 'lightpanda',
  'lp': 'lightpanda',
};

// ── [SECTION: ENTRIES] ───────────────────────────────────────────────────────
// Edit this section when adding new browsers.
// T-0025 populates chrome/brave/arc/chromium/comet from EXEC_CANDIDATES.
// T-0027 populates lightpanda entry.
export const ENTRIES = {
  // Populated by T-0025:
  // chrome, msedge, brave, chromium, arc, comet

  // Populated by T-0027:
  // lightpanda
};

// ── [SECTION: PUBLIC_API] ────────────────────────────────────────────────────

/**
 * Normalize a user-supplied channel string to canonical id.
 * @param {string|undefined} channelRaw
 * @returns {string|null}
 */
export function canonicalizeChannel(channelRaw) {
  if (!channelRaw) return null;
  const lowered = String(channelRaw).toLowerCase().trim();
  return ALIASES[lowered] ?? lowered;
}

/**
 * Look up a registry entry by canonical id.
 * @param {string} id
 * @returns {object|null}
 */
export function getEntry(id) {
  return ENTRIES[id] ?? null;
}

/**
 * List all known entry ids.
 * @returns {string[]}
 */
export function listEntries() {
  return Object.keys(ENTRIES);
}
