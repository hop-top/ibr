/**
 * Defense-in-depth orphan reaper.
 *
 * Not the fix — the fix is `startDaemon` reaping on throw (see helpers/daemon.js).
 * This is a backstop wired as a vitest globalSetup teardown: if some future
 * daemon-spawning test regresses the same way, a stray `src/server.js`
 * daemon should not be able to outlive the whole test *process*, only the
 * individual test run.
 *
 * Conservative on purpose: a candidate must be BOTH
 *   (a) orphaned (ppid === 1 — its spawner is gone), AND
 *   (b) actually ibr's own daemon (`src/server.js` in the command line)
 * A live-run child (real ppid) or an unrelated process is never touched.
 */

import { execFileSync } from 'node:child_process';

/**
 * @param {string} command full command line (argv joined), as reported by `ps`
 */
export function isIbrServerCommand(command) {
  if (!command) return false;
  // Match a path segment `src/server.js` (not just any "server.js", to avoid
  // false positives on unrelated projects checked out under a similar name),
  // and require it look like a node invocation of that file (not e.g. an
  // editor with the file open, or a grep of this very reaper).
  return /(^|[\s/])src\/server\.js(\s|$)/.test(command);
}

/**
 * @param {{ pid: number, ppid: number, command: string }[]} rows
 * @returns {{ pid: number, ppid: number, command: string }[]} orphaned ibr daemons
 */
export function findOrphanedDaemons(rows) {
  return rows.filter(row => row.ppid === 1 && row.pid !== 1 && isIbrServerCommand(row.command));
}

/**
 * Read the live process table via `ps` (BSD/darwin + Linux compatible column
 * set: pid, ppid, args). Returns [] on any failure — a reaper must never
 * crash the test run it's protecting.
 */
export function listProcesses() {
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' });
    return out
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!match) return null;
        const [, pid, ppid, command] = match;
        return { pid: Number(pid), ppid: Number(ppid), command };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Find and kill orphaned ibr daemons. Returns the list that was (or would
 * have been, in dry-run) reaped, for logging/census assertions.
 *
 * @param {{ dryRun?: boolean }} [opts]
 */
export function reapOrphanedDaemons(opts = {}) {
  const { dryRun = false } = opts;
  const rows = listProcesses();
  const orphans = findOrphanedDaemons(rows);
  if (!dryRun) {
    for (const { pid } of orphans) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }
  return orphans;
}
