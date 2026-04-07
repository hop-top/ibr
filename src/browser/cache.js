/**
 * Browser cache layout + lookup.
 *
 * Layout:
 *   ~/.cache/ibr/browsers/<channel>/resolved.json   — channel → version map (TTL 24h)
 *   ~/.cache/ibr/browsers/<channel>/<version>/      — per-version dir
 *     bin/<binary>                                  — executable
 *     meta.json                                     — { sha256, size, downloadedAt, sourceUrl }
 *   ~/.cache/ibr/browsers/<channel>/<version>.lock  — version-scope lock
 *   ~/.cache/ibr/browsers/<channel>/resolving.lock  — channel-scope resolve lock
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0026
 */

import os from 'os';
import path from 'path';
import fs from 'fs/promises';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const STALE_LOCK_MS = 60 * 60 * 1000; // 1h

// Root cache dir. Honors XDG_CACHE_HOME if set.
export function cacheRoot() {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg
    ? path.join(xdg, 'ibr', 'browsers')
    : path.join(os.homedir(), '.cache', 'ibr', 'browsers');
}

export function channelDir(channel) {
  return path.join(cacheRoot(), channel);
}

export function versionDir(channel, version) {
  return path.join(channelDir(channel), version);
}

/**
 * Find a cached binary for (channel, version).
 * Returns { executablePath, meta } or null.
 */
export async function findCached(channel, version) {
  const dir = versionDir(channel, version);
  let meta;
  try {
    meta = await readMeta(channel, version);
  } catch {
    return null;
  }
  if (!meta) return null;
  // Prefer the bin/ subdirectory; otherwise scan dir for executable.
  const binDir = path.join(dir, 'bin');
  let executablePath = null;
  try {
    const binEntries = await fs.readdir(binDir);
    if (binEntries.length > 0) {
      executablePath = path.join(binDir, binEntries[0]);
    }
  } catch {
    // fall back to scanning version dir
  }
  if (!executablePath) {
    try {
      const entries = await fs.readdir(dir);
      for (const name of entries) {
        if (name === 'meta.json') continue;
        if (name.endsWith('.partial')) continue;
        const full = path.join(dir, name);
        const st = await fs.stat(full);
        if (st.isFile()) {
          executablePath = full;
          break;
        }
      }
    } catch {
      return null;
    }
  }
  if (!executablePath) return null;
  // Sanity: file must exist
  try {
    await fs.stat(executablePath);
  } catch {
    return null;
  }
  return { executablePath, meta };
}

/**
 * List all versions for a channel with metadata.
 * Returns array of { version, downloadedAt, sizeBytes }, newest first.
 */
export async function listVersions(channel) {
  const dir = channelDir(channel);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const version = ent.name;
    try {
      const meta = await readMeta(channel, version);
      if (!meta) continue;
      out.push({
        version,
        downloadedAt: meta.downloadedAt || null,
        sizeBytes: meta.size ?? 0,
      });
    } catch {
      // skip corrupted entries
    }
  }
  out.sort((a, b) => {
    const at = a.downloadedAt ? Date.parse(a.downloadedAt) : 0;
    const bt = b.downloadedAt ? Date.parse(b.downloadedAt) : 0;
    return bt - at;
  });
  return out;
}

export async function readMeta(channel, version) {
  const metaPath = path.join(versionDir(channel, version), 'meta.json');
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeMeta(channel, version, meta) {
  const dir = versionDir(channel, version);
  await fs.mkdir(dir, { recursive: true });
  const metaPath = path.join(dir, 'meta.json');
  const tmpPath = `${metaPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(meta, null, 2), 'utf8');
  await fs.rename(tmpPath, metaPath);
}

/**
 * Read resolved.json (channel → version map with TTL).
 * Returns the parsed object or an empty object on ENOENT.
 */
export async function readResolved(channel) {
  const p = path.join(channelDir(channel), 'resolved.json');
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Write the resolved.json file atomically.
 */
export async function writeResolved(channel, resolved) {
  const dir = channelDir(channel);
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, 'resolved.json');
  const tmpPath = `${p}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(resolved, null, 2), 'utf8');
  await fs.rename(tmpPath, p);
}

/**
 * True when the given resolved entry is still within TTL.
 * Entry shape: { version, resolvedAt, ttlMs }
 */
export function isResolvedFresh(entry) {
  if (!entry || !entry.resolvedAt) return false;
  const resolvedAt = Date.parse(entry.resolvedAt);
  if (Number.isNaN(resolvedAt)) return false;
  const ttl = typeof entry.ttlMs === 'number' ? entry.ttlMs : DEFAULT_TTL_MS;
  return Date.now() - resolvedAt < ttl;
}

/**
 * Prune old version directories, `.partial` orphans, and stale lock files.
 * Keeps the N newest versions (by downloadedAt).
 */
export async function pruneOldVersions(channel, { keep = 5 } = {}) {
  const dir = channelDir(channel);
  const removed = { versions: [], partials: [], locks: [] };
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return removed;
  }

  // 1. Stale locks + orphan partials
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isFile() && ent.name.endsWith('.lock')) {
      try {
        const st = await fs.stat(full);
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          await fs.unlink(full);
          removed.locks.push(ent.name);
        }
      } catch {
        // ignore
      }
      continue;
    }
    if (ent.isFile() && ent.name.endsWith('.partial')) {
      try {
        await fs.unlink(full);
        removed.partials.push(ent.name);
      } catch {
        // ignore
      }
    }
  }

  // 2. Keep newest N version dirs
  const versions = await listVersions(channel);
  const victims = versions.slice(keep);
  for (const v of victims) {
    const vdir = versionDir(channel, v.version);
    try {
      await fs.rm(vdir, { recursive: true, force: true });
      removed.versions.push(v.version);
    } catch {
      // ignore
    }
  }

  // 3. Also clean orphan .partial inside version dirs (best effort)
  for (const v of versions.slice(0, keep)) {
    const vdir = versionDir(channel, v.version);
    try {
      const vents = await fs.readdir(vdir);
      for (const name of vents) {
        if (name.endsWith('.partial')) {
          try {
            await fs.unlink(path.join(vdir, name));
            removed.partials.push(`${v.version}/${name}`);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return removed;
}
