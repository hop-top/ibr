/**
 * Browser acquirer — orchestrates local probe → cache → download.
 *
 * Called from resolver.js chain steps 3, 4, 5. Takes a registry entry, returns
 * either an executable path (for launch-kind) or a spawn target (for cdp-server).
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0026
 */

// TODO(T-0026)
export async function acquire(entry, { version, downloadUrl } = {}) {
  throw new Error('src/browser/acquirer.js not yet implemented');
}
