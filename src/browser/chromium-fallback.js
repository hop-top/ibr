/**
 * Chromium pinned-build fallback (T-0109).
 *
 * Playwright pins one exact chromium / chromium_headless_shell revision (see
 * playwright-core/browsers.json). When that pinned build is absent from the
 * ms-playwright cache, chromium.launch() throws:
 *
 *   browserType.launch: Executable doesn't exist at
 *   <cache>/chromium_headless_shell-<rev>/.../chrome-headless-shell
 *
 * …even when several OTHER chromium builds sit cached right beside it. That was
 * the T-0083 incident: pinned -1217 missing while -1140/-1187/-1200/-1208/
 * -1223/-1228/-1234 were all present, yet the run died fatal with no fallback.
 *
 * This module enumerates viable alternatives so the resolver can retry:
 *   1. already-cached ms-playwright chromium builds (newest revision first)
 *   2. system chromium-family channels (chrome, msedge — Playwright-native)
 *
 * If nothing launches, chromiumInstallHint() produces an actionable error
 * naming the exact install command and what was searched.
 *
 * Explicit user choices (BROWSER_EXECUTABLE_PATH / BROWSER_CHANNEL) are NOT
 * handled here — the resolver only invokes this for the default / implicit
 * chromium path, so an explicit choice's failure always surfaces verbatim.
 *
 * Track: adopt-lightpanda
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// Per-platform relative executable path inside a cached
// `chromium_headless_shell-<rev>` directory. Mirrors Playwright's
// EXECUTABLE_PATHS for "chromium-headless-shell" (registry/index.js).
const HEADLESS_SHELL_REL = {
  'darwin-arm64': ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'],
  'darwin-x64': ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'],
  'linux-x64': ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  'linux-arm64': ['chrome-linux', 'headless_shell'],
  'win32-x64': ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
};

/**
 * Root of the Playwright browser cache. Honors PLAYWRIGHT_BROWSERS_PATH,
 * otherwise the OS default cache dir + "ms-playwright" (matching Playwright's
 * defaultRegistryDirectory).
 *
 * @param {object} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function msPlaywrightRoot(env = process.env, platform = os.platform()) {
  const override = env.PLAYWRIGHT_BROWSERS_PATH;
  if (override && override !== '0') return override;

  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'ms-playwright');
  }
  // linux + others: XDG_CACHE_HOME or ~/.cache
  const xdg = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(xdg, 'ms-playwright');
}

/**
 * Is this the Playwright pinned-build "Executable doesn't exist" launch error
 * (the exact failure this module rescues)? Kept narrow so unrelated launch
 * failures (crashes, connection refusals) are NOT swallowed by the fallback.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMissingBrowserError(err) {
  const msg = err && err.message ? String(err.message) : '';
  return msg.includes("Executable doesn't exist");
}

/**
 * Enumerate cached chromium_headless_shell builds present on disk, newest
 * revision first. Each entry: { revision, executablePath }.
 *
 * @param {string} root  ms-playwright cache root
 * @param {object} [opts]
 * @param {NodeJS.Platform} [opts.platform]
 * @param {string} [opts.arch]
 * @param {(dir: string) => string[]} [opts.readdir]
 * @param {(p: string) => boolean}    [opts.exists]
 * @returns {{ revision: number, executablePath: string }[]}
 */
export function listCachedChromiumBuilds(
  root,
  { platform = os.platform(), arch = os.arch(), readdir = defaultReaddir, exists = fs.existsSync } = {},
) {
  const rel = HEADLESS_SHELL_REL[`${platform}-${arch}`];
  if (!rel) return [];

  let entries;
  try {
    entries = readdir(root);
  } catch {
    return [];
  }

  const builds = [];
  for (const name of entries) {
    const m = /^chromium_headless_shell-(\d+)$/.exec(name);
    if (!m) continue;
    const revision = Number(m[1]);
    const executablePath = path.join(root, name, ...rel);
    let present = false;
    try {
      present = exists(executablePath);
    } catch {
      present = false;
    }
    if (present) builds.push({ revision, executablePath });
  }

  builds.sort((a, b) => b.revision - a.revision);
  return builds;
}

function defaultReaddir(dir) {
  return fs.readdirSync(dir);
}

/**
 * Build the ordered list of fallback launch candidates for the implicit
 * chromium path. Cached ms-playwright builds come first (exact same Chromium
 * family, no external dependency), then system channels Playwright resolves
 * natively.
 *
 * Each candidate: { source, executablePath?, channel?, revision?, label }
 *
 * @param {object} [opts]
 * @param {object} [opts.env]
 * @param {NodeJS.Platform} [opts.platform]
 * @param {string} [opts.arch]
 * @param {string} [opts.cacheRoot]
 * @param {(dir: string) => string[]} [opts.readdir]
 * @param {(p: string) => boolean}    [opts.exists]
 * @returns {Array<object>}
 */
export function buildFallbackCandidates({
  env = process.env,
  platform = os.platform(),
  arch = os.arch(),
  cacheRoot,
  readdir,
  exists,
} = {}) {
  const root = cacheRoot ?? msPlaywrightRoot(env, platform);
  const candidates = [];

  for (const build of listCachedChromiumBuilds(root, { platform, arch, readdir, exists })) {
    candidates.push({
      source: 'ms-playwright-cache',
      executablePath: build.executablePath,
      revision: build.revision,
      label: `ms-playwright chromium build ${build.revision}`,
    });
  }

  // Playwright-native system channels — resolved by `channel:` at launch time,
  // so we don't probe paths here; a launch attempt is the probe.
  for (const channel of ['chrome', 'msedge']) {
    candidates.push({
      source: 'system-channel',
      channel,
      label: `system ${channel}`,
    });
  }

  return candidates;
}

/**
 * Build an actionable error message for the "nothing available" terminal case.
 *
 * @param {object} args
 * @param {string[]} args.searched  human-readable list of what was tried
 * @param {string}  [args.pinned]   the missing pinned build path/rev, if known
 * @returns {string}
 */
export function chromiumInstallHint({ searched = [], pinned } = {}) {
  const lines = [
    'No usable Chromium browser found.',
    pinned
      ? `Playwright's pinned build is missing (${pinned}) and no cached or system fallback launched.`
      : `Playwright's pinned Chromium build is missing and no cached or system fallback launched.`,
    '',
    'Install the pinned build with:',
    '    npx playwright install chromium',
    '',
    'Or set BROWSER_CHANNEL=chrome (or BROWSER_EXECUTABLE_PATH=<path>) to use a system browser.',
  ];
  if (searched.length > 0) {
    lines.push('', 'Searched:');
    for (const s of searched) lines.push(`  - ${s}`);
  }
  return lines.join('\n');
}
