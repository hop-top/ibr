/**
 * Browser acquirer — orchestrates local probe → cache → download.
 *
 * Called from resolver.js chain steps 3, 4, 5. Takes a registry entry, returns
 * either an executable path (for launch-kind) or a spawn target (for cdp-server).
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0026
 */

import fs from 'fs/promises';
import path from 'path';

import * as cache from './cache.js';
import * as downloader from './downloader.js';
import { withLock } from './lockfile.js';

async function fileExists(p) {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

function probePaths(entry) {
  const probe = entry.localProbe;
  if (!probe) return [];
  if (Array.isArray(probe)) return probe;
  if (typeof probe === 'object') {
    const key = `${process.platform}-${process.arch}`;
    if (Array.isArray(probe[key])) return probe[key];
    if (Array.isArray(probe[process.platform])) return probe[process.platform];
  }
  return [];
}

function deriveChannelSpec(env, downloadUrl, version) {
  if (downloadUrl || env.BROWSER_DOWNLOAD_URL) return 'custom';
  if (version || env.BROWSER_VERSION) return version || env.BROWSER_VERSION;
  return 'stable';
}

/**
 * Acquire a browser binary. Probe → cache → download chain.
 *
 * @param {object} entry - Registry entry.
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.downloadUrl] - Override download URL.
 * @param {string} [opts.version] - Override version.
 * @returns {Promise<{ executablePath: string, source: 'probe'|'cache'|'download', version: string, meta?: object }>}
 */
export async function acquire(entry, { env = process.env, downloadUrl, version } = {}) {
  if (!entry) throw new Error('acquire: entry is required');

  // Hard gate: Lightpanda on win32.
  if (entry.id === 'lightpanda' && process.platform === 'win32') {
    throw new Error('Lightpanda is not supported on Windows');
  }

  // 1. Local probe.
  for (const p of probePaths(entry)) {
    // eslint-disable-next-line no-await-in-loop
    if (await fileExists(p)) {
      return {
        executablePath: p,
        source: 'probe',
        version: 'local',
      };
    }
  }

  if (!entry.downloadable) {
    throw new Error(
      `acquire: no local binary found for "${entry.id}" and entry is not downloadable. ` +
        `Install it manually (probe paths: ${probePaths(entry).join(', ') || 'none'})`,
    );
  }

  // Env override propagation.
  if (downloadUrl) env = { ...env, BROWSER_DOWNLOAD_URL: downloadUrl };

  const channelSpec = deriveChannelSpec(env, downloadUrl, version);
  const canonicalChannel =
    env.BROWSER_DOWNLOAD_URL || downloadUrl
      ? 'custom'
      : channelSpec === 'latest'
        ? 'stable'
        : channelSpec;

  // 2. Resolve version (under resolving.lock to avoid hammering GitHub).
  const resolvingLock = path.join(cache.channelDir(canonicalChannel), 'resolving.lock');
  const resolved = await withLock(resolvingLock, async () => {
    return await downloader.resolveVersion(entry, channelSpec, { env });
  });

  const finalChannel = resolved.channel || canonicalChannel;
  const resolvedVersion = resolved.version;

  // 3. Cache lookup.
  const hit = await cache.findCached(finalChannel, resolvedVersion);
  if (hit) {
    return {
      executablePath: hit.executablePath,
      source: 'cache',
      version: resolvedVersion,
      meta: hit.meta,
    };
  }

  // 4. Download under version lock, re-checking cache after acquiring.
  const versionLock = path.join(
    cache.channelDir(finalChannel),
    `${resolvedVersion}.lock`,
  );
  const result = await withLock(versionLock, async () => {
    const reHit = await cache.findCached(finalChannel, resolvedVersion);
    if (reHit) {
      return {
        executablePath: reHit.executablePath,
        source: 'cache',
        version: resolvedVersion,
        meta: reHit.meta,
      };
    }
    const dl = await downloader.download(
      entry,
      finalChannel,
      {
        version: resolvedVersion,
        assetUrl: resolved.assetUrl,
        sha256: resolved.sha256,
        requireChecksum: resolved.requireChecksum,
      },
      { env },
    );
    return {
      executablePath: dl.executablePath,
      source: 'download',
      version: resolvedVersion,
      meta: dl.meta,
    };
  });

  return result;
}
