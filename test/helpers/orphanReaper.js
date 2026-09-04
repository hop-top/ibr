/**
 * Defense-in-depth orphan reaper.
 *
 * Not the fix — the fix is `startDaemon` reaping on throw (see helpers/daemon.js).
 * This is a backstop wired as a vitest globalSetup teardown: if some future
 * daemon-spawning test regresses the same way, a stray `src/server.js`
 * daemon should not be able to outlive the whole test *process*, only the
 * individual test run.
 *
 * Conservative on purpose: a candidate must be ALL of:
 *   (a) orphaned (ppid === 1 — its spawner is gone),
 *   (b) actually a `node` process (comm basename matches `node`), AND
 *   (c) its argv names ibr's own `src/server.js` path segment.
 * A live-run child (real ppid) or an unrelated process is never touched —
 * in particular, (b) is required precisely because `args`/argv alone can't
 * be trusted: `vim src/server.js` or `grep src/server.js` both contain the
 * path text but are not node invocations of it, so matching on argv text
 * alone would let the reaper SIGTERM an unrelated orphaned process that
 * merely mentions the file. `comm` (the actual executable) rules those out.
 */

import { execFileSync } from 'node:child_process';

/**
 * @param {string} comm executable basename/path as reported by `ps` `comm=`
 */
function isNodeExecutable(comm) {
  if (!comm) return false;
  return /(^|\/)node$/.test(comm);
}

/**
 * @param {string} args full command line (argv joined), as reported by `ps`
 */
function namesIbrServerJs(args) {
  if (!args) return false;
  // Match a path segment `src/server.js` (not just any "server.js", to avoid
  // false positives on unrelated projects checked out under a similar name).
  return /(^|[\s/])src\/server\.js(\s|$)/.test(args);
}

/**
 * True only when the process record is a real `node` invocation of ibr's
 * `src/server.js` — i.e. both the executable AND the argv must agree. Argv
 * text alone is not sufficient (see module docstring for the vim/grep case).
 *
 * @param {{ comm?: string, command: string }} record
 */
export function isIbrServerCommand(record) {
  if (!record) return false;
  // Back-compat: accept either a record { comm, command } or a bare argv
  // string (treated as node-invocation-unverifiable -> false), so callers
  // that still pass strings fail closed rather than silently matching.
  if (typeof record === 'string') return false;
  return isNodeExecutable(record.comm) && namesIbrServerJs(record.command);
}

/**
 * @param {{ pid: number, ppid: number, comm: string, command: string }[]} rows
 * @returns {{ pid: number, ppid: number, comm: string, command: string }[]} orphaned ibr daemons
 */
export function findOrphanedDaemons(rows) {
  return rows.filter(row => row.ppid === 1 && row.pid !== 1 && isIbrServerCommand(row));
}

/**
 * Parse `ps -axo pid=,ppid=,<lastField>=` output into rows. `<lastField>` is
 * whatever was requested as the third column (comm or args) — kept as the
 * LAST `-o` column deliberately: BSD/darwin `ps` truncates any non-last
 * `-o` column to a small fixed width (observed ~16 chars for comm, ~65 for
 * args) regardless of `-ww`, but the final column is always printed in
 * full. Combining comm+args in one `-o` call would silently truncate
 * whichever one isn't last, corrupting exactly the fields this reaper's
 * safety check depends on — so comm and args are queried in SEPARATE `ps`
 * invocations (see listProcesses) and joined by pid instead.
 */
function parsePidPidField(out) {
  return out
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      const [, pid, ppid, field] = match;
      return { pid: Number(pid), ppid: Number(ppid), field };
    })
    .filter(Boolean);
}

/**
 * Read the live process table. Queries `comm` (actual executable, used to
 * confirm a real `node` invocation) and `args` (full argv, used to confirm
 * it names ibr's server.js) via two separate `ps` calls — each with its
 * target field as the LAST `-o` column — and joins them by pid, to avoid
 * darwin's fixed-width truncation of non-last `-o` columns (see
 * parsePidPidField). Returns [] on any failure — a reaper must never crash
 * the test run it's protecting.
 */
export function listProcesses() {
  try {
    const commOut = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' });
    const argsOut = execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8' });

    const commByPid = new Map(parsePidPidField(commOut).map(r => [r.pid, r.field]));
    const argsRows = parsePidPidField(argsOut);

    return argsRows.map(({ pid, ppid, field: command }) => ({
      pid,
      ppid,
      comm: commByPid.get(pid) ?? '',
      command,
    }));
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
