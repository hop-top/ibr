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

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const POLL_INTERVAL_MS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryCreateLock(lockPath) {
  // Returns the fd on success; throws on failure.
  const fd = fs.openSync(lockPath, 'wx');
  const content = `${process.pid}\n${new Date().toISOString()}\n`;
  fs.writeSync(fd, content);
  fs.closeSync(fd);
}

/**
 * Acquire an exclusive lock, run fn, and release.
 *
 * @param {string} lockPath - Absolute path to the lock file.
 * @param {() => Promise<any>} fn - Async function to run while holding the lock.
 * @param {{ staleMs?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<any>} Whatever fn returns.
 */
export async function withLock(
  lockPath,
  fn,
  { staleMs = 3_600_000, timeoutMs = 30_000 } = {},
) {
  // Ensure parent dir exists.
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });

  const start = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      tryCreateLock(lockPath);
      acquired = true;
      break;
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        // Check staleness
        let st;
        try {
          st = fs.statSync(lockPath);
        } catch (statErr) {
          if (statErr && statErr.code === 'ENOENT') {
            // Raced with a release; retry immediately.
            continue;
          }
          throw statErr;
        }
        if (Date.now() - st.mtimeMs > staleMs) {
          // Stale: remove + retry
          try {
            fs.unlinkSync(lockPath);
          } catch (unlinkErr) {
            if (!unlinkErr || unlinkErr.code !== 'ENOENT') {
              throw unlinkErr;
            }
          }
          continue;
        }
        if (Date.now() - start >= timeoutMs) {
          throw new Error(
            `withLock: timeout after ${timeoutMs}ms waiting for ${lockPath}`,
          );
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      // Anything else (e.g. ENOENT on parent) → propagate with context
      throw new Error(
        `withLock: failed to create lock at ${lockPath}: ${err && err.message ? err.message : err}`,
      );
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore — may already be gone
    }
  }
}
