/**
 * `ibr browser <subcmd>` — browser-manager subcommand router.
 *
 * Subcommands:
 *   list                          Show registry + cache state
 *   pull [channel] [version]      Pre-warm browser cache
 *   prune [--older-than <dur>]    GC old cache entries
 *   which                         Print resolver decision for current env
 *
 * Implemented by: T-0032
 * Track: adopt-lightpanda
 */

const HELP = [
  'Usage: ibr browser <command> [options]',
  '',
  'Commands:',
  '  list                          Show registry + cache state',
  '  pull [channel] [version]      Pre-warm browser cache',
  '  prune [--older-than <dur>]    GC old cache entries',
  '  which                         Print resolver decision for current env',
  '',
  "Run 'ibr browser <command> --help' for per-command options.",
  '',
].join('\n');

/**
 * Run the `ibr browser` subcommand router.
 *
 * @param {string[]} args - Arguments after the `browser` token (process.argv.slice(3)).
 * @returns {Promise<number>} exit code (caller decides whether to call process.exit)
 */
export async function run(args = []) {
  const sub = args[0];

  if (!sub || sub === '--help' || sub === '-h' || sub === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const rest = args.slice(1);

  switch (sub) {
    case 'list': {
      const mod = await import('./list.js');
      return await mod.run(rest);
    }
    case 'pull': {
      const mod = await import('./pull.js');
      return await mod.run(rest);
    }
    case 'prune': {
      const mod = await import('./prune.js');
      return await mod.run(rest);
    }
    case 'which': {
      const mod = await import('./which.js');
      return await mod.run(rest);
    }
    default: {
      process.stderr.write(
        `ibr browser: unknown subcommand "${sub}". ` +
          "Run 'ibr browser --help' for the list of subcommands.\n",
      );
      return 1;
    }
  }
}

export const __HELP__ = HELP;
