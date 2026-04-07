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

// Root cache dir. Honors XDG_CACHE_HOME if set.
export function cacheRoot() {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg
    ? path.join(xdg, 'ibr', 'browsers')
    : path.join(os.homedir(), '.cache', 'ibr', 'browsers');
}

// TODO(T-0026): channelDir, versionDir, findCached, listVersions, readMeta,
//               writeResolved, readResolved, pruneOldVersions
export function channelDir(channel) {
  return path.join(cacheRoot(), channel);
}

export function versionDir(channel, version) {
  return path.join(channelDir(channel), version);
}
