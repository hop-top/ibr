/**
 * upgrade.js — self-upgrade logic for idx.
 *
 * Mirrors the behaviour of hop.top/upgrade (Go package) for Node.js SEA binaries:
 *   - Version check via GitHub releases API or custom URL
 *   - XDG-compliant snooze + cache state
 *   - Atomic binary self-replacement (download → tmp → rename)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const BINARY_NAME = 'idx';
const GITHUB_REPO = 'hop-top/idx';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;   // 4 h
const SNOOZE_MS   = 24 * 60 * 60 * 1000;   // 24 h

// ---------------------------------------------------------------------------
// State directory (XDG_STATE_HOME or ~/.local/state)
// ---------------------------------------------------------------------------

function stateDir() {
  const base = process.env.XDG_STATE_HOME
    || path.join(os.homedir(), '.local', 'state');
  return path.join(base, BINARY_NAME, 'upgrade');
}

function ensureStateDir() {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
}

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------

export function snooze(durationMs = SNOOZE_MS) {
  ensureStateDir();
  const until = Date.now() + durationMs;
  fs.writeFileSync(path.join(stateDir(), 'snooze.json'),
    JSON.stringify({ until }), { mode: 0o600 });
}

export function isSnoozed() {
  try {
    const raw = fs.readFileSync(path.join(stateDir(), 'snooze.json'), 'utf8');
    const { until } = JSON.parse(raw);
    return Date.now() < until;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function saveCache(result) {
  ensureStateDir();
  fs.writeFileSync(path.join(stateDir(), 'cache.json'),
    JSON.stringify(result), { mode: 0o600 });
}

function loadCache() {
  try {
    const raw = fs.readFileSync(path.join(stateDir(), 'cache.json'), 'utf8');
    const cached = JSON.parse(raw);
    if (Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached;
  } catch { /* miss */ }
  return null;
}

// ---------------------------------------------------------------------------
// Version check
// ---------------------------------------------------------------------------

/** @returns {{ current: string, latest: string, url: string, notes: string,
 *              updateAvail: boolean, checkedAt: number }} */
export async function checkForUpdate(current, { releaseUrl } = {}) {
  const cached = loadCache();
  if (cached && cached.current === current) return cached;

  const url = releaseUrl
    || `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

  const res = await fetch(url, {
    headers: releaseUrl ? {} : { Accept: 'application/vnd.github.v3+json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`upgrade: HTTP ${res.status}`);

  const data = await res.json();

  let latest, downloadUrl, notes;

  if (releaseUrl) {
    // custom endpoint: { version, url, notes? }
    latest = (data.version || '').replace(/^v/, '');
    downloadUrl = data.url || '';
    notes = data.notes || '';
  } else {
    // GitHub releases API
    latest = (data.tag_name || '').replace(/^v/, '');
    downloadUrl = selectAsset(data.assets || []);
    notes = (data.body || '').slice(0, 1000);
  }

  const result = {
    current: current.replace(/^v/, ''),
    latest,
    url: downloadUrl,
    notes,
    updateAvail: isNewer(current, latest),
    checkedAt: Date.now(),
  };

  saveCache(result);
  return result;
}

/** Pick the best asset for the current platform. */
function selectAsset(assets) {
  const plat = process.platform === 'darwin' ? 'darwin' : process.platform;
  const arch = process.arch === 'arm64' ? ['arm64', 'aarch64']
    : process.arch === 'x64' ? ['amd64', 'x86_64']
    : [process.arch];

  for (const a of assets) {
    const name = a.name.toLowerCase();
    if (!name.includes(plat)) continue;
    for (const a2 of arch) {
      if (name.includes(a2)) return a.browser_download_url;
    }
  }
  // fallback: first asset matching platform
  return (assets.find(a => a.name.toLowerCase().includes(plat)) || {})
    .browser_download_url || '';
}

// ---------------------------------------------------------------------------
// Semver comparison (mirrors Go package behaviour)
// ---------------------------------------------------------------------------

function parseSemver(s) {
  s = s.replace(/^v/, '');
  const buildIdx = s.indexOf('+');
  if (buildIdx >= 0) s = s.slice(0, buildIdx);

  let pre = '';
  const dashIdx = s.indexOf('-');
  if (dashIdx >= 0) { pre = s.slice(dashIdx + 1); s = s.slice(0, dashIdx); }

  const [major = 0, minor = 0, patch = 0] = s.split('.').map(Number);
  return { major, minor, patch, pre };
}

function comparePre(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;  // release > pre-release
  if (!b) return -1;
  const aParts = a.split('.'), bParts = b.split('.');
  const n = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < n; i++) {
    const ai = aParts[i], bi = bParts[i];
    const an = /^\d+$/.test(ai), bn = /^\d+$/.test(bi);
    if (an && bn) { const d = Number(ai) - Number(bi); if (d) return d; }
    else if (an) return -1;
    else if (bn) return 1;
    else if (ai < bi) return -1;
    else if (ai > bi) return 1;
  }
  return aParts.length - bParts.length;
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePre(a.pre, b.pre);
}

export function isNewer(current, latest) {
  if (!current || !latest) return false;
  return compareSemver(parseSemver(latest), parseSemver(current)) > 0;
}

// ---------------------------------------------------------------------------
// Binary self-replacement
// ---------------------------------------------------------------------------

export async function replaceBinary(downloadUrl) {
  if (!downloadUrl) throw new Error('upgrade: no download URL for this platform');

  const self = process.execPath;
  const dir  = path.dirname(self);
  const tmp  = path.join(dir, `.upgrade-${process.pid}`);

  try {
    const res = await fetch(downloadUrl, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!res.ok) throw new Error(`upgrade: download HTTP ${res.status}`);

    await pipeline(res.body, createWriteStream(tmp));
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, self);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already renamed */ }
  }
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

/** Print a one-liner banner if an update is available and not snoozed. */
export async function notifyIfAvailable(current) {
  if (isSnoozed()) return;
  try {
    const r = await checkForUpdate(current);
    if (r.updateAvail) {
      process.stderr.write(
        `[idx] update available: ${r.current} → ${r.latest}  (run \`idx upgrade\` to install)\n`
      );
    }
  } catch { /* network errors are silent at startup */ }
}

/**
 * Run the interactive/auto upgrade flow.
 * @param {string} current - current version string
 * @param {{ auto?: boolean, quiet?: boolean }} opts
 */
export async function runUpgradeCLI(current, { auto = false, quiet = false } = {}) {
  const r = await checkForUpdate(current);

  if (!r.updateAvail) {
    if (!quiet) process.stdout.write(`idx is up to date (${r.current})\n`);
    return;
  }

  process.stdout.write(`Update available: ${r.current} → ${r.latest}\n`);
  if (r.notes) process.stdout.write(r.notes + '\n');

  if (auto) {
    process.stdout.write(`Installing idx ${r.latest}…\n`);
    await replaceBinary(r.url);
    process.stdout.write(`Upgraded to ${r.latest}. Restart to use the new version.\n`);
    return;
  }

  // interactive
  process.stdout.write('Upgrade now? [y/N/snooze]: ');
  const ans = await readLine();
  if (ans === 'y' || ans === 'Y' || ans === 'yes') {
    process.stdout.write(`Installing idx ${r.latest}…\n`);
    await replaceBinary(r.url);
    process.stdout.write(`Upgraded to ${r.latest}. Restart to use the new version.\n`);
  } else if (ans === 'snooze' || ans === 's') {
    snooze();
    process.stdout.write('Snoozed for 24h.\n');
  } else {
    process.stdout.write('Skipped.\n');
  }
}

function readLine() {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', chunk => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        process.stdin.pause();
        resolve(buf.slice(0, nl).trim());
      }
    });
  });
}
