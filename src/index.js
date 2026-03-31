import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { once } from 'node:events';
import fs from 'node:fs';
import { createAIProvider } from './ai/provider.js';
import { Operations } from './Operations.js';
import { validateEnvironmentVariables, validateBrowserConfig } from './utils/validation.js';
import logger from './utils/logger.js';
import { importCookies, getSupportedCookieBrowsersHelpText } from './utils/cookieImport.js';
import { runDomCommand } from './commands/snap.js';
import { wsmAdapter } from './services/WsmAdapter.js';
import { CliError, ensureCliError, serializeCliError } from './utils/cliErrors.js';
import { createUpgrader } from './utils/upgrader.js';
import { createRequire } from 'node:module';

const _up = createUpgrader({ binary: 'ibr', githubRepo: 'hop-top/ibr' });
const notifyIfAvailable = (v) => _up.notifyIfAvailable(v);
const runUpgradeCLI = (v, opts) => _up.runUpgradeCLI(v, opts);

const _require = createRequire(import.meta.url);
const _pkg = _require('../package.json');
const IBR_VERSION = _pkg.version || 'dev';

// Load environment variables
dotenv.config();

/**
 * Parse --cookies flag from argv.
 *
 * Forms:
 *   --cookies chrome              → { browser: 'chrome', domains: [] }
 *   --cookies arc:github.com,linear.app → { browser: 'arc', domains: ['github.com','linear.app'] }
 *
 * Returns null if flag not present.
 *
 * @param {string[]} argv  process.argv
 * @returns {{ browser: string, domains: string[] } | null}
 */
export function parseCookiesFlag(argv) {
  const cookiesFlagIndex = argv.indexOf('--cookies');
  if (cookiesFlagIndex === -1) return null;

  const raw = argv[cookiesFlagIndex + 1];
  if (!raw || raw.startsWith('--')) {
    throw new Error(
      '--cookies flag requires a value. ' +
      'Usage: --cookies <browser>[:<domain1>,<domain2>]. ' +
      'Example: --cookies chrome  or  --cookies arc:github.com,linear.app. ' +
      `Supported browsers: ${getSupportedCookieBrowsersHelpText()}.`
    );
  }

  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) {
    return { browser: raw, domains: [] };
  }

  const browser = raw.slice(0, colonIdx);
  const domainsRaw = raw.slice(colonIdx + 1);
  const domains = domainsRaw
    .split(',')
    .map(d => d.trim())
    .filter(Boolean);

  return { browser, domains };
}

/**
 * Strip --cookies <value> from argv, returning the remaining args.
 * @param {string[]} argv
 * @returns {string[]}
 */
function stripCookiesFlag(argv) {
  const result = [];
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === '--cookies') {
      i += 2; // skip flag + value
    } else {
      result.push(argv[i]);
      i++;
    }
  }
  return result;
}

/**
 * Get browser configuration from environment or use defaults
 * @returns {Object} Browser configuration
 */
function getBrowserConfig() {
  const headless = process.env.BROWSER_HEADLESS?.toLowerCase() === 'true';
  const slowMo = parseInt(process.env.BROWSER_SLOWMO || '100', 10);
  const timeout = parseInt(process.env.BROWSER_TIMEOUT || '30000', 10);

  // BROWSER_CHANNEL shortcuts: map known browser names to executablePath
  // because Playwright only supports a narrow set of channel strings.
  const CHANNEL_PATHS = {
    brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    chromium: '/Applications/Chromium.app/Contents/MacOS/Chromium',
  };

  const channelRaw = process.env.BROWSER_CHANNEL?.toLowerCase();
  const executablePath = process.env.BROWSER_EXECUTABLE_PATH
    || (channelRaw && CHANNEL_PATHS[channelRaw]);

  return validateBrowserConfig({
    headless,
    slowMo,
    timeout,
    ...(executablePath ? { executablePath } : {}),
  });
}

function emitStructuredError(error) {
  process.stderr.write(`\n${JSON.stringify(serializeCliError(error))}\n`);
}

async function readPromptFromStdin() {
  const stat = fs.fstatSync(0);
  const hasPipedInput = stat.isFIFO() || stat.isFile() || stat.isSocket();

  if (process.stdin.isTTY || !hasPipedInput) {
    return '';
  }

  const stdinReady = await Promise.race([
    once(process.stdin, 'readable').then(() => true),
    once(process.stdin, 'end').then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50)),
  ]);

  if (!stdinReady) {
    return '';
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8').trim();
}

function parseExecutionTimeoutMs() {
  const raw = process.env.EXECUTION_TIMEOUT_MS;
  if (!raw) return null;

  const timeoutMs = Number.parseInt(raw, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new CliError(
      'CONFIG_ERROR',
      `EXECUTION_TIMEOUT_MS must be a positive integer in milliseconds (got: ${raw}). ` +
      'Set EXECUTION_TIMEOUT_MS=1000 to cap a run at 1 second, or unset it for no global timeout.'
    );
  }

  return timeoutMs;
}

const VALID_MODES = new Set(['aria', 'dom', 'auto']);

/**
 * Parse CLI flags from argv.
 * Strips recognised flags and returns remaining positional args + parsed options.
 * @returns {{ args: string[], mode: 'aria'|'dom'|'auto', annotate: boolean }}
 */
function parseCliFlags() {
  const argv = process.argv.slice(2);
  const remaining = [];
  let mode = 'auto';
  let annotate = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode' && argv[i + 1]) {
      const val = argv[++i].toLowerCase();
      if (!VALID_MODES.has(val)) {
        logger.error(
          `Invalid --mode value: "${val}". Must be one of: aria, dom, auto. ` +
          `Use "aria" to force accessibility tree, "dom" for XPath-based DOM, or "auto" (default) to let ibr choose based on page quality.`
        );
        process.exit(1);
      }
      mode = val;
    } else if (argv[i] === '--annotate' || argv[i] === '-a') {
      annotate = true;
    } else {
      remaining.push(argv[i]);
    }
  }

  return { args: remaining, mode, annotate };
}

/**
 * Get operation options from environment + CLI flags
 * @param {string} mode - mode from CLI flags
 * @param {boolean} annotate - annotate mode from CLI flags
 * @returns {Object} Operation options
 */
export function getOperationOptions(mode, annotate = false) {
  const temperature = parseFloat(process.env.AI_TEMPERATURE || '0');

  if (isNaN(temperature) || temperature < 0 || temperature > 2) {
    throw new Error(
      'AI_TEMPERATURE must be a number between 0 and 2 (got: ' + process.env.AI_TEMPERATURE + '). ' +
      'Set AI_TEMPERATURE=0 for deterministic outputs or up to 2 for more creative responses. ' +
      'Remove the env var to use the default (0).'
    );
  }

  return { temperature, mode, annotate };
}

/**
 * Print usage information — plain text to stderr, no logger formatting.
 */
function printUsage() {
  const lines = [
    'ibr - Intent Browser Runtime',
    '',
    'Usage:',
    '  ibr [--cookies <browser>[:<domain,...>]] [--mode aria|dom|auto] [--annotate] "<user_prompt>"',
    '  ibr [--daemon] "<user_prompt>"  - use persistent daemon (faster warm invocations)',
    '  ibr snap <url> [flags]          - inspect DOM at URL',
    '  ibr upgrade [--auto] [--quiet]  - check for and install updates',
    '  ibr upgrade preamble            - print agent skill preamble fragment',
    '  ibr version [--short|--json]    - print version information',
    '',
    'Flags:',
    '  --daemon                         Use persistent browser daemon (opt-in)',
    '  --cookies <browser>              Import all non-expired cookies from browser',
    '  --cookies <browser>:<d1>,<d2>    Import cookies for specific domains only',
    `  Supported browsers: ${getSupportedCookieBrowsersHelpText()}`,
    '  Note: --cookies and --mode are stateless-mode flags; not supported with --daemon',
    '  --annotate, -a               Capture annotated screenshots after each find step',
    '  --mode aria   Force ARIA accessibility tree (ariaSnapshot)',
    '  --mode dom    Force DOM simplifier + XPath',
    '  --mode auto   Auto-select based on quality (default)',
    '  ANNOTATED_SCREENSHOTS_ON_FAILURE=true  Auto-capture on action failure',
    '',
    'snap subcommand flags:',
    '  --aria                        - show ariaSnapshot (ARIA YAML) instead of DOM JSON',
    '  -i                            - interactive elements only',
    '  -a                            - annotated screenshot → /tmp/ibr-dom-annotated.png',
    '  -d <N>                        - depth limit (dom mode only)',
    '  -s <selector>                 - scope to CSS selector subtree (dom mode only)',
    '',
    'Examples:',
    '  ibr "url: https://example.com\\ninstructions:\\n  - click submit button"',
    '  ibr --cookies chrome "url: https://github.com\\ninstructions:\\n  - get repo list"',
    '  ibr --mode dom "url: https://canvas-app.example.com\\ninstructions:\\n  - click submit"',
    '  ibr snap https://example.com -i -d 5',
    '  ibr snap --aria https://example.com',
    '  ibr snap --aria -i https://example.com',
    '',
    'Configuration:',
    '  AI_PROVIDER      - AI provider (openai, anthropic, google) [default: openai]',
    '  AI_TEMPERATURE   - AI temperature 0-2 [default: 0]',
    '  BROWSER_HEADLESS - Launch browser headless (true/false) [default: false]',
    '  BROWSER_SLOWMO   - Slow down browser actions (ms) [default: 100]',
    '  IBR_DAEMON       - Enable daemon mode (true/false) [default: false]',
    '  IBR_STATE_FILE   - Override daemon state file path [default: ~/.ibr/server.json]',
    '',
    'See .env.example for all available configuration options',
  ];
  process.stderr.write(lines.join('\n') + '\n');
}


async function run() {
  const rawArgs = process.argv.slice(2);

  // Short-circuit info subcommands before any logger output.
  if (rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs[0] === 'help') {
    printUsage();
    process.exit(0);
  }
  if (rawArgs[0] === 'version' || rawArgs[0] === 'upgrade') {
    // Fall through to subcommand handlers below without printing the banner.
  } else {
    logger.info('Starting ibr (Intent Browser Runtime)');
  }

  try {
    // Daemon mode routing — must come before any stateless setup
    const daemonMode =
      process.env.IBR_DAEMON === 'true' || rawArgs.includes('--daemon');

    if (daemonMode) {
      const filteredArgs = rawArgs.filter(a => a !== '--daemon');
      const prompt = filteredArgs[0];

      if (!prompt || prompt === '--help' || prompt === '-h') {
        printUsage();
        process.exit(prompt ? 0 : 1);
      }

      const { ensureServer, sendCommand } = await import('./daemon.js');
      const { port, token } = await ensureServer();
      await sendCommand(prompt, port, token);
      return; // sendCommand calls process.exit internally
    }

    // Parse --cookies before other args
    let cookiesConfig = null;
    try {
      cookiesConfig = parseCookiesFlag(process.argv);
    } catch (err) {
      logger.error(err.message);
      printUsage();
      process.exit(1);
    }

    // Strip --cookies flag to get effective argv for prompt detection
    const effectiveArgv = stripCookiesFlag(process.argv);

    // Startup update notification (async, non-blocking; skipped for upgrade/version cmds)
    const _subcmd = process.argv[2];
    if (_subcmd !== 'upgrade' && _subcmd !== 'version') {
      notifyIfAvailable(IBR_VERSION).catch(() => {});
    }

    // Parse CLI flags (--mode) from the already-stripped argv (no --cookies)
    // parseCliFlags reads process.argv, so we temporarily shadow it
    const savedArgv = process.argv;
    process.argv = ['node', 'src/index.js', ...effectiveArgv.slice(2)];
    const { args, mode, annotate } = parseCliFlags();
    process.argv = savedArgv;

    // The prompt is the first remaining positional argument
    let prompt = args[0];

    // Validate command line arguments (after stripping --cookies and --mode)
    if (!prompt) {
      prompt = await readPromptFromStdin();
    }

    if (!prompt) {
      const error = new CliError(
        'CONFIG_ERROR',
        'No user prompt provided. ' +
        'Pass a task description as the first argument, e.g.: ibr "url: https://example.com\\ninstructions:\\n  - click the login button". ' +
        'Run "ibr --help" for full usage.'
      );
      logger.error(error.message);
      emitStructuredError(error);
      printUsage();
      process.exit(1);
    }

    if (prompt === '--help' || prompt === '-h') {
      printUsage();
      process.exit(0);
    }

    // Subcommand: ibr version
    if (process.argv[2] === 'version') {
      const flags = process.argv.slice(3);
      if (flags.includes('--short')) {
        process.stdout.write(IBR_VERSION + '\n');
      } else if (flags.includes('--json')) {
        const info = {
          version: IBR_VERSION,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
        };
        process.stdout.write(JSON.stringify(info, null, 2) + '\n');
      } else {
        process.stdout.write(`ibr v${IBR_VERSION}\n`);
      }
      return;
    }

    // Subcommand: ibr upgrade [--auto] [--quiet] [preamble [--auto|--never]]
    if (process.argv[2] === 'upgrade') {
      const flags = process.argv.slice(3);
      if (flags[0] === 'preamble') {
        const pFlags = flags.slice(1);
        const level = pFlags.includes('--auto') ? 'never'
          : pFlags.includes('--never') ? 'always'
          : 'once';
        process.stdout.write(_up.generatePreamble(level));
        return;
      }
      await runUpgradeCLI(IBR_VERSION, {
        auto: flags.includes('--auto'),
        quiet: flags.includes('--quiet') || flags.includes('-q'),
      });
      return;
    }

    // Subcommand: ibr snap <url> [flags] — no AI provider needed; dispatch early
    if (process.argv[2] === 'snap') {
      const domArgs = process.argv.slice(3);
      try {
        // Parse args early to catch missing URL/invalid flags before launching browser
        const snapOpts = await import('./commands/snap.js').then(m => m.parseDomArgs(domArgs));
        const browserConfig = getBrowserConfig();
        await runDomCommand(domArgs, browserConfig);
      } catch (err) {
        // Only log the message, not the full stack for usage errors
        logger.error(err.message);
        emitStructuredError(ensureCliError(err, 'CONFIG_ERROR'));
        process.exit(1);
      }
      return;
    }

    // Static prompt pre-validation — fail fast before browser launch.
    // Checks that the prompt contains a url: field; saves ~3s browser startup on bad input.
    if (!/^\s*url\s*:/m.test(prompt)) {
      const error = new CliError(
        'CONFIG_ERROR',
        'Prompt must include a "url:" field. ' +
        'Example: "url: https://example.com\\ninstructions:\\n  - click submit". ' +
        'Run "ibr --help" for full usage.'
      );
      logger.error(error.message);
      emitStructuredError(error);
      process.exit(1);
    }

    // Validate required environment variables based on provider
    const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
    const apiKeyMap = {
      'openai': 'OPENAI_API_KEY',
      'anthropic': 'ANTHROPIC_API_KEY',
      'google': 'GOOGLE_GENERATIVE_AI_API_KEY'
    };
    const requiredApiKey = apiKeyMap[provider];

    if (requiredApiKey) {
      validateEnvironmentVariables([requiredApiKey]);
    }

    // Initialize AI provider
    logger.debug('Initializing AI provider');
    const aiProvider = createAIProvider();

    // Get browser and operation configuration
    logger.debug('Loading configuration');
    let browserConfig;
    let operationOptions;
    try {
      browserConfig = getBrowserConfig();
      operationOptions = getOperationOptions(mode, annotate);
    } catch (err) {
      logger.error(err.message);
      emitStructuredError(ensureCliError(err, 'CONFIG_ERROR'));
      process.exit(1);
    }

    const executionTimeoutMs = parseExecutionTimeoutMs();

    logger.debug('Browser configuration', { ...browserConfig, channel: browserConfig.channel || 'default' });
    logger.debug('Operation options', operationOptions);

    // Launch the browser
    logger.info('Launching browser');
    const browser = await chromium.launch(browserConfig);

    try {
      // Create a new browser context and page
      const context = await browser.newContext();

      // WSM workspace-aware cookie injection: if no --cookies flag, check workspace metadata
      if (!cookiesConfig) {
        const wsmProfile = await wsmAdapter.getBrowserProfile();
        if (wsmProfile) {
          logger.info(`WSM workspace specifies browser_profile: ${wsmProfile} — using for cookie import`);
          cookiesConfig = { browser: wsmProfile, domains: [] };
        }
      }

      // Import cookies into context if --cookies was specified (or injected via WSM)
      if (cookiesConfig) {
        logger.info(`Importing cookies from ${cookiesConfig.browser}...`);
        try {
          const result = await importCookies(cookiesConfig.browser, cookiesConfig.domains);
          if (result.count > 0) {
            await context.addCookies(result.cookies);
            logger.info(`Loaded ${result.count} cookies from ${cookiesConfig.browser}`, {
              domains: Object.keys(result.domainCounts).length,
              failed: result.failed,
            });
          } else {
            logger.warn(`No cookies found for ${cookiesConfig.browser}`, {
              domains: cookiesConfig.domains,
            });
          }
        } catch (err) {
          logger.error(
            `Cookie import failed: ${err.message} ` +
            `Continuing without session cookies — authenticated pages may be inaccessible. ` +
            `Check that the browser is installed and, on macOS, grant Keychain access when prompted.`,
            { code: err.code }
          );
          // Non-fatal — continue without session cookies
        }
      }

      const page = await context.newPage();

      // Create Operations instance with context and options
      const operations = new Operations(
        {
          aiProvider: aiProvider,
          page: page,
        },
        operationOptions
      );

      // Parse task description
      logger.info('Parsing task description');
      let taskDescription;

      try {
        taskDescription = await operations.parseTaskDescription(prompt);
      } catch (error) {
        const cliError = ensureCliError(error, 'AI_PARSE_ERROR');
        logger.error('Failed to parse task description. ' +
          'Ensure the prompt includes a "url:" field and an "instructions:" list. ' +
          'Example: "url: https://example.com\\ninstructions:\\n  - click submit". ' +
          'Check AI_PROVIDER and API key env vars if the AI call itself failed.', {
          error: cliError.message,
        });
        emitStructuredError(cliError);
        process.exit(1);
      }

      logger.info('Task description parsed');
      logger.debug('Parsed task', JSON.stringify(taskDescription, null, 2));

      // Execute task
      try {
        logger.info('Starting task execution');
        if (executionTimeoutMs == null) {
          await operations.executeTask(taskDescription);
        } else {
          let timeoutId;
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new CliError(
                'TIMEOUT',
                `Execution exceeded the global timeout of ${executionTimeoutMs} ms. ` +
                'Increase EXECUTION_TIMEOUT_MS or reduce page/action delays for this workflow.'
              ));
            }, executionTimeoutMs);
          });

          try {
            await Promise.race([operations.executeTask(taskDescription), timeoutPromise]);
          } finally {
            clearTimeout(timeoutId);
          }
        }

        logger.info('Task execution completed');
        logger.info('Extracted data:', JSON.stringify(operations.extracts, null, 2));

        // Report token usage
        logger.info('Token usage summary', {
          promptTokens: operations.tokenUsage.prompt,
          completionTokens: operations.tokenUsage.completion,
          totalTokens: operations.tokenUsage.total
        });
      } catch (error) {
        const cliError = ensureCliError(error, 'RUNTIME_ERROR');
        logger.error('Task execution failed. ' +
          'Review the error above for the failing instruction index and observability context. ' +
          'Run "ibr snap <url> -i" to inspect the page state before retrying.', {
          error: cliError.message,
          stage: 'task execution'
        });
        emitStructuredError(cliError);
        process.exit(1);
      }
    } finally {
      // Close the browser
      logger.debug('Closing browser');
      await browser.close();
    }
  } catch (error) {
    const cliError = ensureCliError(error, 'RUNTIME_ERROR');
    logger.error('Fatal error', {
      error: cliError.message,
      code: cliError.code
    });
    emitStructuredError(cliError);
    process.exit(1);
  }
}

run().catch(error => {
  const cliError = ensureCliError(error, 'RUNTIME_ERROR');
  logger.error('Unhandled error in main', { error: cliError.message });
  emitStructuredError(cliError);
  process.exit(1);
});
