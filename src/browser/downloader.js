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

// TODO(T-0026)
export async function download(entry, channel, version) {
  throw new Error('src/browser/downloader.js not yet implemented');
}

// TODO(T-0026)
export async function resolveVersion(entry, channelSpec) {
  throw new Error('src/browser/downloader.js#resolveVersion not yet implemented');
}
