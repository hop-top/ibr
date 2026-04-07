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
//
// Entry shape:
//   id            canonical id (matches key)
//   kind          chromium-launch | cdp-server | native-channel
//   nativeChannel optional Playwright `channel:` string passthrough
//   localProbe    { [os.platform()]: string[] } — ordered candidate exec paths
//   downloadable  bool (T-0026)
//   launcher      module name under ./launchers/ for chromium-launch kind

const HOME = os.homedir();

// win32 paths are relative to %SystemDrive% (defaults to "C:") to avoid
// hardcoding the drive letter — expand at probe time.
function win(rel) {
  return rel; // probe expands; keep raw here
}

export const ENTRIES = {
  // ── Playwright-native channels ─────────────────────────────────────────────
  chrome: {
    id: 'chrome',
    kind: 'chromium-launch',
    nativeChannel: 'chrome',
    localProbe: { darwin: [], linux: [], win32: [] },
    downloadable: false,
    launcher: 'playwright-launch',
  },
  msedge: {
    id: 'msedge',
    kind: 'chromium-launch',
    nativeChannel: 'msedge',
    localProbe: { darwin: [], linux: [], win32: [] },
    downloadable: false,
    launcher: 'playwright-launch',
  },

  // ── Probed (non-native) chromium-family browsers ──────────────────────────
  brave: {
    id: 'brave',
    kind: 'chromium-launch',
    localProbe: {
      darwin: [
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        path.join(HOME, 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
        '/opt/homebrew/bin/brave-browser',
        '/usr/local/bin/brave-browser',
      ],
      linux: [
        '/usr/bin/brave-browser',
        '/usr/bin/brave',
        '/snap/brave/current/brave',
        '/var/lib/flatpak/app/com.brave.Browser/current/active/bin/brave',
        '/usr/local/bin/brave-browser',
        '/usr/local/bin/brave',
      ],
      win32: [
        win('Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        win('Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      ],
    },
    downloadable: false,
    launcher: 'playwright-launch',
  },

  chromium: {
    id: 'chromium',
    kind: 'chromium-launch',
    localProbe: {
      darwin: [
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        path.join(HOME, 'Applications/Chromium.app/Contents/MacOS/Chromium'),
        '/opt/homebrew/bin/chromium',
        '/usr/local/bin/chromium',
      ],
      linux: [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/chromium/current/usr/lib/chromium-browser/chromium-browser',
        '/var/lib/flatpak/app/org.chromium.Chromium/current/active/bin/chromium',
        '/usr/local/bin/chromium',
      ],
      win32: [
        win('Program Files\\Chromium\\Application\\chrome.exe'),
        win('Program Files (x86)\\Chromium\\Application\\chrome.exe'),
      ],
    },
    downloadable: false,
    launcher: 'playwright-launch',
  },

  arc: {
    id: 'arc',
    kind: 'chromium-launch',
    localProbe: {
      darwin: [
        '/Applications/Arc.app/Contents/MacOS/Arc',
        path.join(HOME, 'Applications/Arc.app/Contents/MacOS/Arc'),
      ],
      linux: [],
      win32: [],
    },
    downloadable: false,
    launcher: 'playwright-launch',
  },

  comet: {
    id: 'comet',
    kind: 'chromium-launch',
    localProbe: {
      darwin: [
        '/Applications/Comet.app/Contents/MacOS/Comet',
        path.join(HOME, 'Applications/Comet.app/Contents/MacOS/Comet'),
      ],
      linux: [],
      win32: [],
    },
    downloadable: false,
    launcher: 'playwright-launch',
  },

  // ── CDP-server browsers (downloadable) ────────────────────────────────────
  lightpanda: {
    id: 'lightpanda',
    kind: 'cdp-server',
    aliases: ['panda', 'lp'],
    downloadable: true,
    launcher: 'playwright-connect',
    spawner: 'lightpanda-spawner',
    localProbe: {
      darwin: [
        path.join(HOME, '.p/sandbox/panda/zig-out/bin/lightpanda'),
        '/opt/homebrew/bin/lightpanda',
        '/usr/local/bin/lightpanda',
      ],
      linux: [
        path.join(HOME, '.p/sandbox/panda/zig-out/bin/lightpanda'),
        '/usr/local/bin/lightpanda',
        '/usr/bin/lightpanda',
      ],
      win32: [],
    },
    releases: {
      provider: 'github',
      repo: 'lightpanda-io/browser',
      channels: {
        nightly: {
          resolver: 'tag',
          tag: 'nightly',
          assetPattern: 'lightpanda-{arch}-{os}',
          requireChecksum: false,
        },
        stable: {
          resolver: 'newest-non-prerelease',
          assetPattern: 'lightpanda-{arch}-{os}',
          requireChecksum: true,
        },
        latest: {
          resolver: 'alias',
          aliasOf: 'stable',
          requireChecksum: true,
        },
      },
    },
  },
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
