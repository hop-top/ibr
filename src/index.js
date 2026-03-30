import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { createAIProvider } from './ai/provider.js';
import { Operations } from './Operations.js';
import { validateEnvironmentVariables, validateBrowserConfig } from './utils/validation.js';
import logger from './utils/logger.js';
import { importCookies } from './utils/cookieImport.js';
import { runDomCommand } from './commands/snap.js';
import { wsmAdapter } from './services/WsmAdapter.js';

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
      'Supported browsers: chrome, arc, brave, edge, comet.'
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

  return validateBrowserConfig({
    headless,
    slowMo,
    timeout,
    channel: process.env.BROWSER_CHANNEL
  });
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
 * Print usage information
 */
function printUsage() {
  logger.info('ibr - Intent Browser Runtime');
  logger.info('');
  logger.info('Usage:');
  logger.info('  ibr [--cookies <browser>[:<domain,...>]] [--mode aria|dom|auto] [--annotate] "<user_prompt>"');
  logger.info('  ibr [--daemon] "<user_prompt>"  - use persistent daemon (faster warm invocations)');
  logger.info('  ibr snap <url> [flags]          - inspect DOM at URL');
  logger.info('');
  logger.info('Flags:');
  logger.info('  --daemon                         Use persistent browser daemon (opt-in)');
  logger.info('  --cookies <browser>              Import all non-expired cookies from browser');
  logger.info('  --cookies <browser>:<d1>,<d2>    Import cookies for specific domains only');
  logger.info('  Supported browsers: chrome, arc, brave, edge, comet');
  logger.info('  Note: --cookies and --mode are stateless-mode flags; not supported with --daemon');
  logger.info('  --annotate, -a               Capture annotated screenshots after each find step');
  logger.info('  --mode aria   Force ARIA accessibility tree (ariaSnapshot)');
  logger.info('  --mode dom    Force DOM simplifier + XPath');
  logger.info('  --mode auto   Auto-select based on quality (default)');
  logger.info('  ANNOTATED_SCREENSHOTS_ON_FAILURE=true  Auto-capture on action failure');
  logger.info('');
  logger.info('snap subcommand flags:');
  logger.info('  --aria                        - show ariaSnapshot (ARIA YAML) instead of DOM JSON');
  logger.info('  -i                            - interactive elements only');
  logger.info('  -a                            - annotated screenshot → /tmp/ibr-dom-annotated.png');
  logger.info('  -d <N>                        - depth limit (dom mode only)');
  logger.info('  -s <selector>                 - scope to CSS selector subtree (dom mode only)');
  logger.info('');
  logger.info('Examples:');
  logger.info('  ibr "url: https://example.com\\ninstructions:\\n  - click submit button"');
  logger.info('  ibr --cookies chrome "url: https://github.com\\ninstructions:\\n  - get repo list"');
  logger.info('  ibr --mode dom "url: https://canvas-app.example.com\\ninstructions:\\n  - click submit"');
  logger.info('  ibr snap https://example.com -i -d 5');
  logger.info('  ibr snap --aria https://example.com');
  logger.info('  ibr snap --aria -i https://example.com');
  logger.info('');
  logger.info('Configuration:');
  logger.info('  AI_PROVIDER      - AI provider (openai, anthropic, google) [default: openai]');
  logger.info('  AI_TEMPERATURE   - AI temperature 0-2 [default: 0]');
  logger.info('  BROWSER_HEADLESS - Launch browser headless (true/false) [default: false]');
  logger.info('  BROWSER_SLOWMO   - Slow down browser actions (ms) [default: 100]');
  logger.info('  IBR_DAEMON       - Enable daemon mode (true/false) [default: false]');
  logger.info('  IBR_STATE_FILE   - Override daemon state file path [default: ~/.ibr/server.json]');
  logger.info('');
  logger.info('See .env.example for all available configuration options');
}

async function run() {
  logger.info('Starting ibr (Intent Browser Runtime)');

  try {
    // Daemon mode routing — must come before any stateless setup
    const rawArgs = process.argv.slice(2);
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

    // Parse CLI flags (--mode) from the already-stripped argv (no --cookies)
    // parseCliFlags reads process.argv, so we temporarily shadow it
    const savedArgv = process.argv;
    process.argv = ['node', 'src/index.js', ...effectiveArgv.slice(2)];
    const { args, mode, annotate } = parseCliFlags();
    process.argv = savedArgv;

    // The prompt is the first remaining positional argument
    const prompt = args[0];

    // Validate command line arguments (after stripping --cookies and --mode)
    if (!prompt) {
      logger.error(
        'No user prompt provided. ' +
        'Pass a task description as the first argument, e.g.: ibr "url: https://example.com\\ninstructions:\\n  - click the login button". ' +
        'Run "ibr --help" for full usage.'
      );
      printUsage();
      process.exit(1);
    }

    if (prompt === '--help' || prompt === '-h') {
      printUsage();
      process.exit(0);
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
        process.exit(1);
      }
      return;
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
      process.exit(1);
    }

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
            `Check that the browser is installed and you granted Keychain access when prompted.`,
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
        logger.error('Failed to parse task description. ' +
          'Ensure the prompt includes a "url:" field and an "instructions:" list. ' +
          'Example: "url: https://example.com\\ninstructions:\\n  - click submit". ' +
          'Check AI_PROVIDER and API key env vars if the AI call itself failed.', {
          error: error.message,
        });
        process.exit(1);
      }

      logger.info('Task description parsed');
      logger.debug('Parsed task', JSON.stringify(taskDescription, null, 2));

      // Execute task
      try {
        logger.info('Starting task execution');
        await operations.executeTask(taskDescription);

        logger.info('Task execution completed');
        logger.info('Extracted data:', JSON.stringify(operations.extracts, null, 2));

        // Report token usage
        logger.info('Token usage summary', {
          promptTokens: operations.tokenUsage.prompt,
          completionTokens: operations.tokenUsage.completion,
          totalTokens: operations.tokenUsage.total
        });
      } catch (error) {
        logger.error('Task execution failed. ' +
          'Review the error above for the failing instruction index and observability context. ' +
          'Run "ibr snap <url> -i" to inspect the page state before retrying.', {
          error: error.message,
          stage: 'task execution'
        });
        process.exit(1);
      }
    } finally {
      // Close the browser
      logger.debug('Closing browser');
      await browser.close();
    }
  } catch (error) {
    logger.error('Fatal error', {
      error: error.message,
      code: error.code
    });
    process.exit(1);
  }
}

run().catch(error => {
  logger.error('Unhandled error in main', { error: error.message });
  process.exit(1);
});
