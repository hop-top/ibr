/**
 * Zero-dep exclusive lockfile using fs.openSync(path, 'wx').
 *
 * Stale detection: lock file older than staleMs (default 1h) is treated as
 * abandoned and removed before retrying. PID inside lock helps debug.
 *
 * Sufficient for peer ibr processes on local filesystem. Not safe for
 * network filesystems (NFS, etc.) — ibr cache is always local.
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0026
 */

// TODO(T-0026)
export async function withLock(lockPath, fn, { staleMs = 3_600_000, timeoutMs = 30_000 } = {}) {
  throw new Error('src/browser/lockfile.js not yet implemented');
}
