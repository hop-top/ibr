/**
 * Browser downloader — fetches portable binaries per registry entry.
 *
 * See spec §"Version semantics" and §"Downloader". Key steps:
 *   1. Resolve version (stable/nightly/latest → provider API; exact → direct)
 *   2. Stream to <cache>/<channel>/<version>/<asset>.partial
 *   3. Verify sha256 (per requireChecksum policy)
 *   4. Atomic rename .partial → final + meta.json
 *   5. chmod +x on unix
 *
 * Concurrency via zero-dep lockfile (src/browser/lockfile.js).
 * Re-checks cache after acquiring lock before starting download.
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0026
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

import * as cache from './cache.js';

// Provider imported lazily so tests can mock it cleanly.
async function loadProvider(name) {
  if (name === 'github') {
    return await import('./providers/github.js');
  }
  throw new Error(`downloader: unknown provider "${name}"`);
}

function stripV(version) {
  return typeof version === 'string' && /^v\d/.test(version)
    ? version.slice(1)
    : version;
}

function syntheticCustomVersion(url) {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  return `custom-${hash.slice(0, 12)}`;
}

/**
 * Resolve a channelSpec to concrete version + asset metadata.
 * Handles: stable, nightly, latest (alias stable), exact version, BROWSER_DOWNLOAD_URL override.
 *
 * @param {object} entry - Registry entry.
 * @param {string} channelSpec - stable|nightly|latest|<exact>
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ version: string, assetUrl: string, sha256: string|null, requireChecksum: boolean, channel: string }>}
 */
export async function resolveVersion(entry, channelSpec, { env = process.env } = {}) {
  // 1. BROWSER_DOWNLOAD_URL hard override.
  if (env.BROWSER_DOWNLOAD_URL) {
    const url = env.BROWSER_DOWNLOAD_URL;
    return {
      version: syntheticCustomVersion(url),
      assetUrl: url,
      sha256: null,
      requireChecksum: false,
      channel: 'custom',
    };
  }

  const requireChecksumGlobal = env.BROWSER_REQUIRE_CHECKSUM === 'true';
  const releases = entry.releases || {};
  const channels = releases.channels || {};

  // 2. Exact version (matches `0.2.8`, `v0.2.6`, etc.) — anything that is NOT a known channel name.
  const known = new Set(['stable', 'nightly', 'latest']);
  if (channelSpec && !known.has(channelSpec)) {
    const version = stripV(channelSpec);
    // For exact version, delegate to provider to resolve asset URL + sha256.
    const provider = await loadProvider(releases.provider || 'github');
    let resolved;
    try {
      resolved = await provider.resolveChannel(releases.repo, version, channels);
    } catch (err) {
      throw new Error(
        `resolveVersion: provider failed to resolve exact version "${version}": ${err.message}`,
      );
    }
    return {
      version: stripV(resolved.tag || version),
      assetUrl: resolved.assetUrl,
      sha256: resolved.sha256 || null,
      // Provider returns per-channel requireChecksum from the registry
      // channelEntry; honor it (plus global env override + legacy
      // top-level entry.releases.requireChecksum fallback).
      requireChecksum:
        requireChecksumGlobal || !!resolved.requireChecksum || !!releases.requireChecksum,
      channel: version,
    };
  }

  // 3. Named channel (stable | nightly | latest).
  const canonicalChannel = channelSpec === 'latest' ? 'stable' : channelSpec;

  // TTL cache via resolved.json.
  const resolvedFile = await cache.readResolved(canonicalChannel);
  const cached = resolvedFile[canonicalChannel];
  if (cache.isResolvedFresh(cached)) {
    return {
      version: cached.version,
      assetUrl: cached.assetUrl,
      sha256: cached.sha256 || null,
      // Cached TTL entry carries its own requireChecksum (persisted below
      // via entryOut). Fall back to registry if upgrading from an older
      // cache that lacks the field.
      requireChecksum:
        requireChecksumGlobal ||
        !!cached.requireChecksum ||
        !!releases.requireChecksum,
      channel: canonicalChannel,
    };
  }

  // 4. Query provider.
  let provider;
  try {
    provider = await loadProvider(releases.provider || 'github');
  } catch (err) {
    throw new Error(`resolveVersion: ${err.message}`);
  }

  let networkResolved;
  try {
    networkResolved = await provider.resolveChannel(
      releases.repo,
      canonicalChannel,
      channels,
    );
  } catch (err) {
    // Network failure: fall back to last-known entry if any.
    if (cached && cached.version) {
      return {
        version: cached.version,
        assetUrl: cached.assetUrl,
        sha256: cached.sha256 || null,
        requireChecksum:
          requireChecksumGlobal ||
          !!cached.requireChecksum ||
          !!releases.requireChecksum,
        channel: canonicalChannel,
      };
    }
    throw new Error(
      `resolveVersion: unable to resolve channel "${canonicalChannel}" (no cached fallback): ${err.message}`,
    );
  }

  const version = stripV(networkResolved.tag);
  const entryOut = {
    version,
    assetUrl: networkResolved.assetUrl,
    sha256: networkResolved.sha256 || null,
    // Persist per-channel requireChecksum into the cache so the fresh
    // path + net-fail fallback both observe the same policy without
    // re-resolving via the provider.
    requireChecksum: !!networkResolved.requireChecksum,
    resolvedAt: new Date().toISOString(),
    ttlMs: 24 * 60 * 60 * 1000,
  };
  resolvedFile[canonicalChannel] = entryOut;
  try {
    await cache.writeResolved(canonicalChannel, resolvedFile);
  } catch {
    // Non-fatal: caching the resolution is best-effort.
  }

  return {
    version,
    assetUrl: networkResolved.assetUrl,
    sha256: networkResolved.sha256 || null,
    requireChecksum:
      requireChecksumGlobal ||
      !!networkResolved.requireChecksum ||
      !!releases.requireChecksum,
    channel: canonicalChannel,
  };
}

function assetFilenameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname) || 'browser-binary';
    return base;
  } catch {
    return 'browser-binary';
  }
}

function emitProgress(obj) {
  try {
    process.stderr.write(JSON.stringify(obj) + '\n');
  } catch {
    // ignore
  }
}

/**
 * Download a browser binary into the cache atomically.
 *
 * @returns {Promise<{ executablePath: string, meta: object }>}
 */
export async function download(
  entry,
  channel,
  { version, assetUrl, sha256, requireChecksum },
  { env = process.env } = {},
) {
  if (!assetUrl) throw new Error('download: assetUrl is required');
  if (!version) throw new Error('download: version is required');

  const requireChecksumGlobal = env.BROWSER_REQUIRE_CHECKSUM === 'true';
  if (requireChecksumGlobal && !sha256) {
    throw new Error(
      `download: BROWSER_REQUIRE_CHECKSUM=true but no sha256 provided for ${assetUrl}`,
    );
  }
  if (requireChecksum && !sha256) {
    throw new Error(
      `download: requireChecksum=true but no sha256 provided for ${assetUrl}`,
    );
  }

  const dir = cache.versionDir(channel, version);
  await fsp.mkdir(dir, { recursive: true });
  const filename = assetFilenameFromUrl(assetUrl);
  const finalPath = path.join(dir, filename);
  const partialPath = `${finalPath}.partial`;

  // Clean any leftover partial.
  try {
    await fsp.unlink(partialPath);
  } catch {
    // ignore
  }

  const res = await fetch(assetUrl);
  if (!res || !res.ok) {
    throw new Error(
      `download: fetch failed for ${assetUrl}: ${res ? res.status : 'no response'}`,
    );
  }

  const total = Number(res.headers?.get?.('content-length') || 0);
  let bytes = 0;
  const hash = crypto.createHash('sha256');
  const isTTY = Boolean(process.stdout && process.stdout.isTTY);

  // Throttle NDJSON progress events — per-chunk emission spams stderr
  // (thousands of lines for a multi-MB binary) and overwhelms CI log
  // parsers. Emit at most once per second AND at each 10% milestone.
  // TTY progress bar update is cheap and stays per-chunk for smooth UX.
  let lastProgressEmitMs = 0;
  let lastProgressEmitPct = -1;
  const PROGRESS_EMIT_INTERVAL_MS = 1000;
  function shouldEmitProgress(pct) {
    const now = Date.now();
    if (now - lastProgressEmitMs >= PROGRESS_EMIT_INTERVAL_MS) {
      lastProgressEmitMs = now;
      lastProgressEmitPct = pct;
      return true;
    }
    if (pct >= lastProgressEmitPct + 10) {
      lastProgressEmitMs = now;
      lastProgressEmitPct = pct;
      return true;
    }
    return false;
  }

  const ws = fs.createWriteStream(partialPath);

  // Node's fetch() exposes a web ReadableStream on body; convert to a node stream.
  const body = res.body;
  if (!body) {
    // destroy (not close) to release fd immediately; unlink orphan .partial
    ws.destroy();
    try {
      await fsp.unlink(partialPath);
    } catch {
      // ignore — orphan cleanup is best-effort
    }
    throw new Error(`download: empty response body for ${assetUrl}`);
  }

  // Tap the stream to hash + track progress.
  const tap = new Readable({ read() {} });

  (async () => {
    try {
      const reader = body.getReader ? body.getReader() : null;
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            hash.update(value);
            bytes += value.length;
            const pct = total ? Math.floor((bytes / total) * 100) : 0;
            if (shouldEmitProgress(pct)) {
              emitProgress({
                event: 'browser.downloaded',
                channel,
                version,
                url: assetUrl,
                bytes,
                total,
                pct,
              });
            }
            if (isTTY) {
              try {
                process.stderr.write(
                  `\r[browser] ${channel}/${version} ${bytes}/${total || '?'} (${pct}%)`,
                );
              } catch {
                // ignore
              }
            }
            tap.push(Buffer.from(value));
          }
        }
      } else if (typeof body[Symbol.asyncIterator] === 'function') {
        for await (const chunk of body) {
          hash.update(chunk);
          bytes += chunk.length;
          const pct = total ? Math.floor((bytes / total) * 100) : 0;
          if (shouldEmitProgress(pct)) {
            emitProgress({
              event: 'browser.downloaded',
              channel,
              version,
              url: assetUrl,
              bytes,
              total,
              pct,
            });
          }
          tap.push(chunk);
        }
      } else {
        throw new Error('download: unsupported body stream shape');
      }
      // Final 100% event + newline for TTY bar.
      emitProgress({
        event: 'browser.downloaded',
        channel,
        version,
        url: assetUrl,
        bytes,
        total: total || bytes,
        pct: 100,
      });
      if (isTTY) {
        try { process.stderr.write('\n'); } catch { /* ignore */ }
      }
      tap.push(null);
    } catch (err) {
      tap.destroy(err);
    }
  })();

  try {
    await pipeline(tap, ws);
  } catch (err) {
    try {
      await fsp.unlink(partialPath);
    } catch {
      // ignore
    }
    throw new Error(`download: stream failed: ${err.message}`);
  }

  if (isTTY) {
    try {
      process.stderr.write('\n');
    } catch {
      // ignore
    }
  }

  // Verify sha256 if provided.
  const actualSha = hash.digest('hex');
  if (sha256) {
    if (actualSha.toLowerCase() !== sha256.toLowerCase()) {
      try {
        await fsp.unlink(partialPath);
      } catch {
        // ignore
      }
      throw new Error(
        `download: sha256 mismatch for ${assetUrl}: expected ${sha256}, got ${actualSha}`,
      );
    }
  }

  // Atomic rename .partial → final (same dir guarantees EXDEV safety).
  await fsp.rename(partialPath, finalPath);

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(finalPath, 0o755);
    } catch {
      // ignore
    }
  }

  const meta = {
    sha256: sha256 || actualSha,
    size: bytes,
    downloadedAt: new Date().toISOString(),
    sourceUrl: assetUrl,
    requireChecksum: !!requireChecksum,
  };
  await cache.writeMeta(channel, version, meta);

  return { executablePath: finalPath, meta };
}
