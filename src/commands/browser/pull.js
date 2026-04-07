/**
 * `ibr browser pull [channel] [version]` — pre-warm browser cache.
 *
 * Behavior:
 *   - Looks up registry entry for `channel`. If missing or not downloadable,
 *     prints an error listing downloadable entries and exits with code 4 / 2.
 *   - Delegates to acquirer.acquire(entry, { env, version }) which runs the
 *     probe → cache → download chain. If a local probe satisfies the request
 *     we report it ("local install found; nothing to pull") rather than
 *     forcing a download (a future --force flag may override this).
 *
 * Exit codes:
 *   0  success
 *   2  bad args
 *   3  download / acquire failure
 *   4  unknown registry entry
 *
 * Implemented by: T-0032
 * Track: adopt-lightpanda
 */

import * as registry from '../../browser/registry.js';
import * as acquirer from '../../browser/acquirer.js';

const HELP = [
  'Usage: ibr browser pull <channel> [version] [--json]',
  '',
  'Pre-warm the browser cache for the given registry channel.',
  '',
  'Arguments:',
  '  channel    Registry id (e.g. "lightpanda"). Must be downloadable.',
  '  version    "stable" (default), "nightly", "latest", or exact version',
  '',
  'Flags:',
  '  --json     Emit a JSON result line on success',
  '',
].join('\n');

function downloadableIds() {
  return registry
    .listEntries()
    .map((id) => registry.getEntry(id))
    .filter((e) => e && e.downloadable)
    .map((e) => e.id);
}

/**
 * Run the pull subcommand.
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function run(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }

  const json = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--'));
  const channelRaw = positional[0];
  const version = positional[1] || 'stable';

  if (!channelRaw) {
    const ids = downloadableIds();
    process.stderr.write(
      'ibr browser pull: missing <channel> argument. ' +
        `Downloadable channels: ${ids.length ? ids.join(', ') : '(none)'}\n`,
    );
    return 2;
  }

  const channelId = registry.canonicalizeChannel(channelRaw);
  const entry = registry.getEntry(channelId);
  if (!entry) {
    const ids = downloadableIds();
    process.stderr.write(
      `ibr browser pull: unknown channel "${channelRaw}". ` +
        `Downloadable channels: ${ids.length ? ids.join(', ') : '(none)'}\n`,
    );
    return 4;
  }
  if (!entry.downloadable) {
    const ids = downloadableIds();
    process.stderr.write(
      `ibr browser pull: channel "${channelId}" is not downloadable. ` +
        `Downloadable channels: ${ids.length ? ids.join(', ') : '(none)'}\n`,
    );
    return 2;
  }

  let result;
  try {
    result = await acquirer.acquire(entry, { env: process.env, version });
  } catch (err) {
    process.stderr.write(`ibr browser pull: failed to acquire ${channelId}@${version}: ${err.message}\n`);
    return 3;
  }

  if (result.source === 'probe') {
    const msg = `local install found for ${channelId}; nothing to pull (path: ${result.executablePath})`;
    if (json) {
      process.stdout.write(
        JSON.stringify({
          event: 'browser.pull.skipped',
          channel: channelId,
          source: 'probe',
          executablePath: result.executablePath,
          message: msg,
        }) + '\n',
      );
    } else {
      process.stdout.write(msg + '\n');
    }
    return 0;
  }

  const summary = `pulled ${channelId}@${result.version} → ${result.executablePath}`;
  if (json) {
    process.stdout.write(
      JSON.stringify({
        event: 'browser.pull.complete',
        channel: channelId,
        version: result.version,
        source: result.source,
        executablePath: result.executablePath,
        message: summary,
      }) + '\n',
    );
  } else {
    process.stdout.write(summary + '\n');
  }
  return 0;
}
