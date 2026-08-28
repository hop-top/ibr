/**
 * Unit tests for test/helpers/orphanReaper.js — the defense-in-depth reaper
 * that runs as a vitest globalSetup teardown. Backstop only: if a daemon
 * e2e helper ever regresses and orphans a src/server.js daemon again, this
 * makes sure it can't outlive the test run.
 *
 * Conservative by design: only ppid===1 (orphaned) processes whose command
 * line matches ibr's own src/server.js are ever candidates — never a live
 * run's child process, never an unrelated node process.
 */

import { describe, it, expect } from 'vitest';
import { findOrphanedDaemons, isIbrServerCommand } from '../../helpers/orphanReaper.js';

describe('isIbrServerCommand', () => {
  it('matches a command line invoking src/server.js', () => {
    expect(isIbrServerCommand('/usr/bin/node /Users/x/ibr/src/server.js')).toBe(true);
  });

  it('matches regardless of node path / extra args', () => {
    expect(isIbrServerCommand('node --some-flag /repo/hops/main/src/server.js')).toBe(true);
  });

  it('does not match unrelated node processes', () => {
    expect(isIbrServerCommand('/usr/bin/node /repo/src/index.js')).toBe(false);
    expect(isIbrServerCommand('/usr/bin/node some-other-server.js')).toBe(false);
  });

  it('does not match a chrome-headless-shell process', () => {
    expect(isIbrServerCommand('/path/to/chrome-headless-shell --headless')).toBe(false);
  });
});

describe('findOrphanedDaemons', () => {
  function proc(pid, ppid, command) {
    return { pid, ppid, command };
  }

  it('selects only ppid===1 AND server.js-matching processes', () => {
    const rows = [
      proc(100, 1, '/usr/bin/node /repo/src/server.js'),      // orphan daemon -> candidate
      proc(101, 5000, '/usr/bin/node /repo/src/server.js'),   // has a live parent -> NOT a candidate
      proc(102, 1, '/usr/bin/node /repo/src/index.js'),       // orphaned but not a daemon -> NOT a candidate
      proc(103, 1, '/path/chrome-headless-shell'),            // orphaned browser, not the daemon itself -> NOT a candidate
    ];

    const result = findOrphanedDaemons(rows);

    expect(result.map(r => r.pid)).toEqual([100]);
  });

  it('returns an empty list when nothing matches (conservative default)', () => {
    const rows = [
      proc(1, 0, '/sbin/launchd'),
      proc(200, 1, '/usr/bin/some-unrelated-daemon'),
    ];

    expect(findOrphanedDaemons(rows)).toEqual([]);
  });

  it('never selects pid 1 itself even if command text is coincidentally matching', () => {
    const rows = [proc(1, 0, 'node src/server.js')]; // pid 1 has ppid 0, not 1 — sanity guard
    expect(findOrphanedDaemons(rows)).toEqual([]);
  });
});
