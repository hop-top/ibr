/**
 * Browser channel resolution for Playwright.
 *
 * Playwright natively supports a fixed set of channel strings (chrome, msedge, …).
 * For browsers it doesn't know (Brave, Arc, Comet, Chromium system install) we
 * probe a prioritised list of candidate paths and pass the first found as
 * `executablePath`.
 *
 * Usage:
 *   const cfg = resolveBrowserChannel('brave');
 *   // → { executablePath: '/Applications/Brave Browser.app/…' }
 *   //   or { channel: 'msedge' } for Edge
 *   //   or {} when channel is unset / default Playwright chromium wanted
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// ─── Playwright-native channels ──────────────────────────────────────────────
// These are passed straight through as `channel:` — Playwright resolves the path.
const NATIVE_CHANNELS = new Set([
  'chrome', 'chrome-beta', 'chrome-dev', 'chrome-canary',
  'msedge', 'msedge-beta', 'msedge-dev', 'msedge-canary',
]);

// ─── Alias normalisation ──────────────────────────────────────────────────────
// Map user-friendly names → canonical channel key used below.
const ALIASES = {
  'google-chrome': 'chrome',
  'google chrome': 'chrome',
  'edge': 'msedge',
  'microsoft-edge': 'msedge',
  'microsoft edge': 'msedge',
};

// ─── Candidate executable paths per browser per platform ─────────────────────
// Ordered by priority: most common install location first.
// win32 paths are relative to the drive root (%SystemDrive%) to avoid
// hardcoding C: — we expand them at runtime.
const EXEC_CANDIDATES = {
  brave: {
    darwin: [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      path.join(os.homedir(), 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
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
      'Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ],
  },
  chromium: {
    darwin: [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(os.homedir(), 'Applications/Chromium.app/Contents/MacOS/Chromium'),
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
      'Program Files\\Chromium\\Application\\chrome.exe',
      'Program Files (x86)\\Chromium\\Application\\chrome.exe',
    ],
  },
  arc: {
    darwin: [
      '/Applications/Arc.app/Contents/MacOS/Arc',
      path.join(os.homedir(), 'Applications/Arc.app/Contents/MacOS/Arc'),
    ],
    linux: [],
    win32: [],
  },
  comet: {
    darwin: [
      '/Applications/Comet.app/Contents/MacOS/Comet',
      path.join(os.homedir(), 'Applications/Comet.app/Contents/MacOS/Comet'),
    ],
    linux: [],
    win32: [],
  },
};

/**
 * Expand a win32 relative path to an absolute one using %SystemDrive%.
 * Falls back to C: if the env var is not set.
 */
function expandWin32Path(rel) {
  const drive = process.env.SystemDrive || 'C:';
  return path.join(drive + path.sep, rel);
}

/**
 * Probe a list of candidate paths and return the first one that exists.
 * @param {string[]} candidates
 * @returns {string|null}
 */
function probe(candidates) {
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore — treat as not found
    }
  }
  return null;
}

/**
 * Resolve a BROWSER_CHANNEL value to Playwright launch options.
 *
 * @param {string|undefined} channelRaw  Value of BROWSER_CHANNEL env var.
 * @returns {{ channel?: string, executablePath?: string }}
 *   Empty object when channelRaw is falsy (use Playwright's bundled Chromium).
 *   Throws if channel is specified but no executable can be found.
 */
export function resolveBrowserChannel(channelRaw) {
  if (!channelRaw) return {};

  const channel = ALIASES[channelRaw.toLowerCase()] ?? channelRaw.toLowerCase();

  // Playwright handles these natively — pass straight through.
  if (NATIVE_CHANNELS.has(channel)) {
    return { channel };
  }

  // For everything else, probe candidate paths.
  const platformCandidates = EXEC_CANDIDATES[channel]?.[process.platform] ?? [];

  const candidates = process.platform === 'win32'
    ? platformCandidates.map(expandWin32Path)
    : platformCandidates;

  if (candidates.length === 0) {
    throw new Error(
      `Browser "${channelRaw}" is not supported on ${process.platform}. ` +
      `Supported values: chrome, msedge, brave, chromium, arc (macOS), comet (macOS). ` +
      `Use BROWSER_EXECUTABLE_PATH to specify a custom path.`
    );
  }

  const found = probe(candidates);
  if (!found) {
    throw new Error(
      `Browser "${channelRaw}" not found on this system. Searched:\n` +
      candidates.map(p => `  ${p}`).join('\n') + '\n' +
      `Install the browser or set BROWSER_EXECUTABLE_PATH to its executable.`
    );
  }

  return { executablePath: found };
}
