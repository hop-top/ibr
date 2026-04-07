/**
 * Capability manifest — self-healing known-broken store for lightpanda.
 *
 * Keyed by (lightpandaVersion, playwrightVersion) tuple. Populated on
 * fallback success: when lightpanda fails and BROWSER_FALLBACK succeeds on
 * the fallback browser, record the signature so future runs warn pre-flight.
 *
 * Storage path:
 *   <cache.cacheRoot()>/lightpanda/capabilities.json
 *
 * Schema (v1):
 *   {
 *     "version": 1,
 *     "entries": {
 *       "<lp>|<pw>": {
 *         "recordedAt": "ISO",
 *         "knownBroken": [
 *           { "signature": "sha256:...", "opKind": "click",
 *             "errorFingerprint": "...", "observedCount": 3,
 *             "lastSeen": "ISO", "fallbackSucceededOn": "chromium" }
 *         ]
 *       }
 *     }
 *   }
 *
 * See spec §"Capability manifest (self-healing)".
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0031
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { cacheRoot } from './cache.js';

const MANIFEST_VERSION = 1;
const MANIFEST_FILE = 'capabilities.json';
const MANIFEST_SUBDIR = 'lightpanda';

// ── version key ──────────────────────────────────────────────────────────────

/**
 * Build the version key tuple used to scope manifest entries.
 * @param {string} lightpandaVersion
 * @param {string} playwrightVersion
 * @returns {string}
 */
export function versionKey(lightpandaVersion, playwrightVersion) {
  return `${lightpandaVersion || 'unknown'}|${playwrightVersion || 'unknown'}`;
}

// ── playwright version detection ─────────────────────────────────────────────

let _playwrightVersionCache = null;

/**
 * Memoized lookup of the Playwright version pinned in this project's
 * package.json. Reads dependencies first then devDependencies. Strips
 * leading caret/tilde. Returns 'unknown' when absent.
 *
 * @returns {string}
 */
export function detectPlaywrightVersion() {
  if (_playwrightVersionCache !== null) return _playwrightVersionCache;
  try {
    // Walk up from this module looking for the nearest package.json. We
    // start at the module's own directory and ascend until we find one
    // with a "name" field — good enough for both repo and bundled SEA use.
    const here = path.dirname(fileURLToPath(import.meta.url));
    let dir = here;
    let pkg = null;
    for (let i = 0; i < 8; i += 1) {
      const candidate = path.join(dir, 'package.json');
      try {
        const raw = fsSync.readFileSync(candidate, 'utf8');
        pkg = JSON.parse(raw);
        if (pkg && (pkg.dependencies || pkg.devDependencies)) break;
      } catch {
        // continue walking
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    const raw =
      (pkg?.dependencies && pkg.dependencies.playwright) ||
      (pkg?.devDependencies && pkg.devDependencies.playwright) ||
      null;
    _playwrightVersionCache = raw ? String(raw).replace(/^[\^~]/, '') : 'unknown';
  } catch {
    _playwrightVersionCache = 'unknown';
  }
  return _playwrightVersionCache;
}

// ── error fingerprinting ─────────────────────────────────────────────────────

/**
 * Reduce a thrown error to a stable, low-cardinality fingerprint suitable
 * for grouping observations of "the same failure". Strips noise that
 * varies across runs (URLs, IDs, numbers) and clamps to 200 chars.
 *
 * @param {*} err
 * @returns {string}
 */
export function fingerprintError(err) {
  const msg = String(err?.message ?? err ?? '');
  return msg
    .split('\n')[0]
    .replace(/https?:\/\/\S+/g, '<URL>')
    .replace(/[0-9a-f-]{8,}/gi, '<ID>')
    .replace(/\d+/g, '<N>')
    .slice(0, 200);
}

// ── storage helpers ──────────────────────────────────────────────────────────

function manifestPath(rootOverride) {
  const root = rootOverride ?? cacheRoot();
  return path.join(root, MANIFEST_SUBDIR, MANIFEST_FILE);
}

function emptyManifest() {
  return { version: MANIFEST_VERSION, entries: {} };
}

/**
 * Load the capability manifest. Returns a default empty manifest when the
 * file does not exist or is corrupted (corrupted = treated as missing so
 * a single bad write doesn't poison future runs).
 *
 * @param {string} [rootOverride]  cache root override (tests)
 * @returns {Promise<object>}
 */
export async function loadManifest(rootOverride) {
  const p = manifestPath(rootOverride);
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
      return emptyManifest();
    }
    if (parsed.version !== MANIFEST_VERSION) return emptyManifest();
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyManifest();
    return emptyManifest();
  }
}

/**
 * Atomically write the capability manifest (write `.tmp` then rename).
 *
 * @param {object} manifest
 * @param {string} [rootOverride]
 * @returns {Promise<void>}
 */
export async function saveManifest(manifest, rootOverride) {
  const p = manifestPath(rootOverride);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

// ── lookups + mutations ──────────────────────────────────────────────────────

/**
 * Check whether a signature is recorded as known-broken under the given
 * version key. Returns the matching entry or null.
 *
 * @param {string} key
 * @param {string} sig
 * @param {string} [rootOverride]
 * @returns {Promise<object|null>}
 */
export async function isKnownBroken(key, sig, rootOverride) {
  const manifest = await loadManifest(rootOverride);
  const bucket = manifest.entries[key];
  if (!bucket || !Array.isArray(bucket.knownBroken)) return null;
  const hit = bucket.knownBroken.find((e) => e.signature === sig);
  return hit ?? null;
}

/**
 * Upsert a known-broken record. If a row with the same signature already
 * exists under the version key, bump observedCount and refresh lastSeen
 * (and any new fields). Otherwise insert a new row.
 *
 * @param {string} key
 * @param {object} record
 * @param {string} record.signature
 * @param {string} record.opKind
 * @param {string} [record.errorFingerprint]
 * @param {string} [record.fallbackSucceededOn]
 * @param {string} [rootOverride]
 * @returns {Promise<object>}  the upserted row
 */
export async function recordBroken(key, record, rootOverride) {
  if (!record || !record.signature || !record.opKind) {
    throw new Error('capability-manifest: recordBroken requires { signature, opKind }');
  }
  const manifest = await loadManifest(rootOverride);
  const now = new Date().toISOString();
  if (!manifest.entries[key]) {
    manifest.entries[key] = { recordedAt: now, knownBroken: [] };
  }
  const bucket = manifest.entries[key];
  if (!Array.isArray(bucket.knownBroken)) bucket.knownBroken = [];
  bucket.recordedAt = now;
  let row = bucket.knownBroken.find((e) => e.signature === record.signature);
  if (row) {
    row.observedCount = (row.observedCount || 0) + 1;
    row.lastSeen = now;
    if (record.errorFingerprint) row.errorFingerprint = record.errorFingerprint;
    if (record.fallbackSucceededOn) row.fallbackSucceededOn = record.fallbackSucceededOn;
    if (record.opKind) row.opKind = record.opKind;
  } else {
    row = {
      signature: record.signature,
      opKind: record.opKind,
      errorFingerprint: record.errorFingerprint || '',
      observedCount: 1,
      lastSeen: now,
      fallbackSucceededOn: record.fallbackSucceededOn || null,
    };
    bucket.knownBroken.push(row);
  }
  await saveManifest(manifest, rootOverride);
  return row;
}

/**
 * Drop the oldest version-key buckets, keeping the N most recently
 * recorded. Used to bound manifest growth across many lightpanda upgrades.
 *
 * @param {number} [keep=5]
 * @param {string} [rootOverride]
 * @returns {Promise<string[]>}  removed version keys
 */
export async function pruneOldVersionKeys(keep = 5, rootOverride) {
  const manifest = await loadManifest(rootOverride);
  const keys = Object.keys(manifest.entries);
  if (keys.length <= keep) return [];
  const sorted = keys
    .map((k) => ({ key: k, t: Date.parse(manifest.entries[k]?.recordedAt || '') || 0 }))
    .sort((a, b) => b.t - a.t);
  const victims = sorted.slice(keep).map((v) => v.key);
  for (const k of victims) delete manifest.entries[k];
  await saveManifest(manifest, rootOverride);
  return victims;
}
