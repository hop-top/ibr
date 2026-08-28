/**
 * Vitest globalSetup — runs once for the whole run, outside the per-file
 * worker pool. The returned function is the teardown, run once after every
 * test file has finished.
 *
 * Backstop for the daemon-orphan leak (see helpers/daemon.js + helpers/
 * orphanReaper.js): even with the reap-on-throw fix in the e2e daemon
 * helper, this sweeps for any src/server.js daemon that ended up orphaned
 * (ppid===1) by the run and kills it, so a future regression can't
 * accumulate leaked daemons+browsers run over run.
 */

import { reapOrphanedDaemons } from './helpers/orphanReaper.js';

export default async function setup() {
  return async function teardown() {
    const reaped = reapOrphanedDaemons();
    if (reaped.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[globalSetup] reaped ${reaped.length} orphaned ibr daemon(s): ` +
        reaped.map(r => r.pid).join(', ')
      );
    }
  };
}
