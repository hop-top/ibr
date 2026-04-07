/**
 * `ibr browser which` — print resolver decision for current env. Dry-run only.
 *
 * Calls resolver.resolveRecord(process.env) and prints the resolution record
 * along with the relevant env vars. NEVER launches a browser or downloads.
 *
 * Flags:
 *   --json   emit the record as JSON
 *
 * Implemented by: T-0032
 * Track: adopt-lightpanda
 */

import * as resolver from '../../browser/resolver.js';

const HELP = [
  'Usage: ibr browser which [--json]',
  '',
  'Dry-run the browser resolver for the current env. Does not launch.',
  '',
  'Flags:',
  '  --json   Emit the resolution record as JSON',
  '',
].join('\n');

const RELEVANT_ENV = [
  'BROWSER_CHANNEL',
  'BROWSER_CDP_URL',
  'LIGHTPANDA_WS',
  'BROWSER_EXECUTABLE_PATH',
  'BROWSER_VERSION',
  'BROWSER_DOWNLOAD_URL',
];

function summarizeEnv(env) {
  const out = {};
  for (const k of RELEVANT_ENV) {
    if (env[k]) out[k] = env[k];
  }
  return out;
}

/**
 * Run the which subcommand.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function run(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const json = args.includes('--json');

  const { record, channelId } = resolver.resolveRecord(process.env);
  const envSummary = summarizeEnv(process.env);

  const isAcquireSentinel = record && record.kind === '__needs_acquire__';

  if (json) {
    const payload = {
      channel: channelId ?? null,
      record: isAcquireSentinel
        ? {
            kind: '__needs_acquire__',
            note: 'would download via acquirer',
            entry: record.entry
              ? {
                  id: record.entry.id,
                  kind: record.entry.kind,
                  downloadable: !!record.entry.downloadable,
                }
              : null,
          }
        : record,
      env: envSummary,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return 0;
  }

  const lines = [];
  lines.push(`channel: ${channelId ?? '(none)'}`);
  if (isAcquireSentinel) {
    lines.push('kind: (would acquire)');
    lines.push('source: needs-acquire');
    lines.push('note: would download via acquirer');
    if (record.entry) {
      lines.push(`registry.id: ${record.entry.id}`);
      lines.push(`registry.kind: ${record.entry.kind}`);
      lines.push(`registry.downloadable: ${!!record.entry.downloadable}`);
    }
  } else {
    lines.push(`kind: ${record.kind ?? '(none)'}`);
    lines.push(`source: ${record.source ?? '(none)'}`);
    if (record.version != null) lines.push(`version: ${record.version}`);
    if (record.executablePath) lines.push(`executablePath: ${record.executablePath}`);
    if (record.wsEndpoint) lines.push(`wsEndpoint: ${record.wsEndpoint}`);
  }

  lines.push('');
  lines.push('env:');
  if (Object.keys(envSummary).length === 0) {
    lines.push('  (none of BROWSER_CHANNEL/BROWSER_CDP_URL/LIGHTPANDA_WS/BROWSER_EXECUTABLE_PATH set)');
  } else {
    for (const k of RELEVANT_ENV) {
      if (envSummary[k]) lines.push(`  ${k}=${envSummary[k]}`);
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}
