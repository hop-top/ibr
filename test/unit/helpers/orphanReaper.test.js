/**
 * Unit tests for test/helpers/orphanReaper.js — the defense-in-depth reaper
 * that runs as a vitest globalSetup teardown. Backstop only: if a daemon
 * e2e helper ever regresses and orphans a src/server.js daemon again, this
 * makes sure it can't outlive the test run.
 *
 * Conservative by design: a candidate must be ALL of (a) orphaned
 * (ppid===1), (b) a real `node` executable (checked via `comm`, not argv
 * text), AND (c) argv names ibr's own src/server.js. A live run's child
 * process, an unrelated node process, and a NON-node process whose argv
 * merely happens to mention "src/server.js" (e.g. `vim src/server.js`,
 * `grep src/server.js`) must never match — argv text alone is not proof of
 * a node invocation.
 */

import { describe, it, expect } from 'vitest';
import { findOrphanedDaemons, isIbrServerCommand } from '../../helpers/orphanReaper.js';

function record(comm, command) {
  return { comm, command };
}

describe('isIbrServerCommand', () => {
  it('matches a real node invocation of src/server.js', () => {
    expect(isIbrServerCommand(record('/usr/bin/node', '/usr/bin/node /Users/x/ibr/src/server.js'))).toBe(true);
  });

  it('matches regardless of node path / extra args', () => {
    expect(isIbrServerCommand(record('node', 'node --some-flag /repo/hops/main/src/server.js'))).toBe(true);
  });

  it('matches a homebrew-style absolute node path in comm', () => {
    expect(isIbrServerCommand(record(
      '/opt/homebrew/Cellar/node/26.7.0/bin/node',
      '/opt/homebrew/Cellar/node/26.7.0/bin/node /Users/x/ibr/hops/main/src/server.js'
    ))).toBe(true);
  });

  it('does not match unrelated node processes', () => {
    expect(isIbrServerCommand(record('/usr/bin/node', '/usr/bin/node /repo/src/index.js'))).toBe(false);
    expect(isIbrServerCommand(record('/usr/bin/node', '/usr/bin/node some-other-server.js'))).toBe(false);
  });

  it('does not match a chrome-headless-shell process', () => {
    expect(isIbrServerCommand(record('chrome-headless-shell', '/path/to/chrome-headless-shell --headless'))).toBe(false);
  });

  // Regression coverage for the review finding: argv text alone is not
  // sufficient. A non-node process whose argv happens to contain the
  // "src/server.js" substring (an editor with the file open, a grep of
  // this very repo) must NOT be treated as ibr's daemon.
  it('does NOT match a vim process with server.js open (non-node executable)', () => {
    expect(isIbrServerCommand(record('vim', 'vim /Users/x/ibr/src/server.js'))).toBe(false);
  });

  it('does NOT match a grep process searching for server.js (non-node executable)', () => {
    expect(isIbrServerCommand(record('grep', 'grep src/server.js'))).toBe(false);
  });

  it('does NOT match when comm is missing/empty even if argv matches', () => {
    expect(isIbrServerCommand(record('', 'node /repo/src/server.js'))).toBe(false);
    expect(isIbrServerCommand(record(undefined, 'node /repo/src/server.js'))).toBe(false);
  });

  it('fails closed on a bare string input (no comm to verify against)', () => {
    expect(isIbrServerCommand('node /repo/src/server.js')).toBe(false);
  });

  it('fails closed on null/undefined', () => {
    expect(isIbrServerCommand(null)).toBe(false);
    expect(isIbrServerCommand(undefined)).toBe(false);
  });
});

describe('findOrphanedDaemons', () => {
  function proc(pid, ppid, comm, command) {
    return { pid, ppid, comm, command };
  }

  it('selects only ppid===1 AND a real node invocation of server.js', () => {
    const rows = [
      proc(100, 1, 'node', '/usr/bin/node /repo/src/server.js'),        // orphan daemon -> candidate
      proc(101, 5000, 'node', '/usr/bin/node /repo/src/server.js'),     // has a live parent -> NOT a candidate
      proc(102, 1, 'node', '/usr/bin/node /repo/src/index.js'),         // orphaned but not the daemon -> NOT a candidate
      proc(103, 1, 'chrome-headless-shell', '/path/chrome-headless-shell'), // orphaned browser, not the daemon -> NOT a candidate
      proc(104, 1, 'vim', 'vim /repo/src/server.js'),                   // orphaned editor with file open -> NOT a candidate
      proc(105, 1, 'grep', 'grep src/server.js'),                       // orphaned grep -> NOT a candidate
    ];

    const result = findOrphanedDaemons(rows);

    expect(result.map(r => r.pid)).toEqual([100]);
  });

  it('returns an empty list when nothing matches (conservative default)', () => {
    const rows = [
      proc(1, 0, 'launchd', '/sbin/launchd'),
      proc(200, 1, 'some-unrelated-daemon', '/usr/bin/some-unrelated-daemon'),
    ];

    expect(findOrphanedDaemons(rows)).toEqual([]);
  });

  it('never selects pid 1 itself even if command text is coincidentally matching', () => {
    const rows = [proc(1, 0, 'node', 'node src/server.js')]; // pid 1 has ppid 0, not 1 — sanity guard
    expect(findOrphanedDaemons(rows)).toEqual([]);
  });
});
