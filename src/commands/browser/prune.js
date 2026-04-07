/**
 * `ibr browser prune [--older-than <dur>]` — GC old cache entries.
 *
 * Flags:
 *   --older-than <dur>   Prune by age (e.g. 30d, 2w, 6h, 15m). Overrides keep-N.
 *   --channel <id>       Prune only one channel; default = all channels in cache root
 *   --dry-run            Don't delete anything; print what would be removed
 *
 * Default behavior (no --older-than): keep newest 5 versions per channel
 * via cache.pruneOldVersions.
 *
 * Implemented by: T-0032
 * Track: adopt-lightpanda
 */

import fs from 'fs/promises';
import path from 'path';

import * as cache from '../../browser/cache.js';

const HELP = [
  'Usage: ibr browser prune [--older-than <dur>] [--channel <id>] [--dry-run]',
  '',
  'Garbage-collect old browser cache entries.',
  '',
  'Flags:',
  '  --older-than <dur>   Prune entries older than dur (e.g. 30d, 2w, 6h, 15m)',
  '  --channel <id>       Prune only one channel (default: all)',
  '  --dry-run            Print what would be removed; delete nothing',
  '',
].join('\n');

const DUR_RE = /^(\d+)([dwhm])$/;

/**
 * Parse a duration string like "30d", "2w", "6h", "15m" into milliseconds.
 * Throws on invalid input.
 */
export function parseDuration(s) {
  const m = String(s || '').trim().match(DUR_RE);
  if (!m) {
    throw new Error(
      `invalid duration "${s}". Expected forms: 30d, 2w, 6h, 15m`,
    );
  }
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const factor =
    unit === 'm' ? 60 * 1000
    : unit === 'h' ? 60 * 60 * 1000
    : unit === 'd' ? 24 * 60 * 60 * 1000
    : /* w */     7 * 24 * 60 * 60 * 1000;
  return n * factor;
}

function parseArgs(args) {
  const out = { olderThan: null, channel: null, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--older-than') {
      out.olderThan = args[++i];
    } else if (a === '--channel') {
      out.channel = args[++i];
    } else if (a === '--dry-run') {
      out.dryRun = true;
    }
  }
  return out;
}

async function listChannelDirs(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function dirSize(p) {
  let total = 0;
  const queue = [p];
  while (queue.length) {
    const cur = queue.pop();
    let entries;
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        queue.push(full);
      } else {
        try {
          // eslint-disable-next-line no-await-in-loop
          const st = await fs.stat(full);
          total += st.size;
        } catch {
          // ignore
        }
      }
    }
  }
  return total;
}

/**
 * Age-based pruner. Removes versions whose meta.downloadedAt is older
 * than `olderThanMs`. Returns { versions: string[], freed: number }.
 */
export async function pruneByAge(channel, olderThanMs, { dryRun = false } = {}) {
  const versions = await cache.listVersions(channel);
  const now = Date.now();
  const removed = [];
  let freed = 0;
  for (const v of versions) {
    const t = v.downloadedAt ? Date.parse(v.downloadedAt) : 0;
    if (!t || now - t < olderThanMs) continue;
    const vdir = cache.versionDir(channel, v.version);
    // eslint-disable-next-line no-await-in-loop
    const size = await dirSize(vdir);
    if (!dryRun) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fs.rm(vdir, { recursive: true, force: true });
      } catch {
        continue;
      }
    }
    removed.push(v.version);
    freed += size;
  }
  return { versions: removed, freed };
}

/**
 * Run the prune subcommand.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function run(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  const opts = parseArgs(args);
  let olderThanMs = null;
  if (opts.olderThan) {
    try {
      olderThanMs = parseDuration(opts.olderThan);
    } catch (err) {
      process.stderr.write(`ibr browser prune: ${err.message}\n`);
      return 2;
    }
  }

  const root = cache.cacheRoot();
  const channels = opts.channel ? [opts.channel] : await listChannelDirs(root);

  let totalRemoved = 0;
  let totalFreed = 0;
  const perChannel = [];

  for (const ch of channels) {
    if (olderThanMs != null) {
      // eslint-disable-next-line no-await-in-loop
      const r = await pruneByAge(ch, olderThanMs, { dryRun: opts.dryRun });
      perChannel.push({ channel: ch, removed: r.versions, freed: r.freed });
      totalRemoved += r.versions.length;
      totalFreed += r.freed;
    } else if (opts.dryRun) {
      // eslint-disable-next-line no-await-in-loop
      const versions = await cache.listVersions(ch);
      const victims = versions.slice(5).map((v) => v.version);
      perChannel.push({ channel: ch, removed: victims, freed: 0 });
      totalRemoved += victims.length;
    } else {
      // eslint-disable-next-line no-await-in-loop
      const r = await cache.pruneOldVersions(ch, { keep: 5 });
      perChannel.push({ channel: ch, removed: r.versions, freed: 0 });
      totalRemoved += r.versions.length;
    }
  }

  for (const p of perChannel) {
    if (p.removed.length === 0) continue;
    process.stdout.write(
      `${p.channel}: ${opts.dryRun ? 'would remove' : 'removed'} ${p.removed.length} version(s) [${p.removed.join(', ')}]\n`,
    );
  }
  process.stdout.write(
    `${opts.dryRun ? 'would remove' : 'removed'} ${totalRemoved} versions, freed ${totalFreed} bytes\n`,
  );
  return 0;
}
