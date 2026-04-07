/**
 * `ibr browser list` — show registry entries + cache state.
 *
 * Columns: ID | Kind | Downloadable | Local probe | Cached versions
 *
 * Flags:
 *   --json   emit JSON array instead of text table
 *
 * Implemented by: T-0032
 * Track: adopt-lightpanda
 */

import * as registry from '../../browser/registry.js';
import * as cache from '../../browser/cache.js';

const HELP = [
  'Usage: ibr browser list [--json]',
  '',
  'Show registry entries + cache state.',
  '',
  'Flags:',
  '  --json   Emit JSON array instead of text table',
  '',
].join('\n');

function probeCount(entry) {
  const probe = entry.localProbe;
  if (!probe) return 0;
  if (Array.isArray(probe)) return probe.length;
  if (typeof probe === 'object') {
    const arr = probe[process.platform];
    return Array.isArray(arr) ? arr.length : 0;
  }
  return 0;
}

function isNativeChannel(entry) {
  return Boolean(entry.nativeChannel) || registry.NATIVE_CHANNELS?.has?.(entry.id);
}

/**
 * Collect listing rows for the current environment.
 * Exposed for tests.
 */
export async function collectRows() {
  const ids = registry.listEntries();
  const rows = [];
  for (const id of ids) {
    const entry = registry.getEntry(id);
    if (!entry) continue;
    // eslint-disable-next-line no-await-in-loop
    const versions = await cache.listVersions(id).catch(() => []);
    rows.push({
      id: entry.id,
      kind: entry.kind || '',
      downloadable: !!entry.downloadable,
      localProbe: isNativeChannel(entry) ? 'native' : String(probeCount(entry)),
      cachedVersions: versions.map((v) => v.version),
    });
  }
  return rows;
}

function pad(s, w) {
  s = String(s);
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}

function renderTable(rows) {
  const header = ['ID', 'Kind', 'Downloadable', 'Local probe', 'Cached versions'];
  const data = rows.map((r) => [
    r.id,
    r.kind,
    r.downloadable ? 'yes' : 'no',
    r.localProbe,
    r.cachedVersions.length ? r.cachedVersions.join(',') : '-',
  ]);
  const all = [header, ...data];
  const widths = header.map((_, ci) =>
    all.reduce((max, row) => Math.max(max, String(row[ci]).length), 0),
  );
  const lines = all.map((row) =>
    row.map((cell, ci) => pad(cell, widths[ci])).join('  ').trimEnd(),
  );
  return lines.join('\n') + '\n';
}

/**
 * Run the list subcommand.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function run(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const json = args.includes('--json');
  const rows = await collectRows();

  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    process.stdout.write(renderTable(rows));
  }
  return 0;
}
