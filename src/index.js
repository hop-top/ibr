import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { createAIProvider } from './ai/provider.js';
import { Operations } from './Operations.js';
import { validateEnvironmentVariables, validateBrowserConfig } from './utils/validation.js';
import logger from './utils/logger.js';
import { importCookies } from './utils/cookieImport.js';
import { runDomCommand } from './commands/snap.js';

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
function parseCookiesFlag(argv) {
  const idx = argv.indexOf('--cookies');
  if (idx === -1) return null;

  const raw = argv[idx + 1];
  if (!raw || raw.startsWith('--')) {
    throw new Error('--cookies requires a value: --cookies <browser>[:<domain,...>]');
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
 * @returns {{ args: string[], mode: 'aria'|'dom'|'auto' }}
 */
function parseCliFlags() {
  const argv = process.argv.slice(2);
  const remaining = [];
  let mode = 'auto';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode' && argv[i + 1]) {
      const val = argv[++i].toLowerCase();
      if (!VALID_MODES.has(val)) {
        logger.error(`Invalid --mode value: "${val}". Must be aria, dom, or auto.`);
        process.exit(1);
      }
      mode = val;
    } else {
      remaining.push(argv[i]);
    }
  }

  return { args: remaining, mode };
}

/**
 * Get operation options from environment + CLI flags
 * @param {string} mode - mode from CLI flags
 * @returns {Object} Operation options
 */
function getOperationOptions(mode) {
  const temperature = parseFloat(process.env.AI_TEMPERATURE || '0');

  if (isNaN(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('AI_TEMPERATURE must be a number between 0 and 2');
  }

  return { temperature, mode };
}

/**
 * Print usage information
 */
function printUsage() {
  logger.info('idx - Intent Driven eXtractor');
  logger.info('');
  logger.info('Usage:');
  logger.info('  idx [--cookies <browser>[:<domain,...>]] [--mode aria|dom|auto] "<user_prompt>"');
  logger.info('  idx [--daemon] "<user_prompt>"  - use persistent daemon (faster warm invocations)');
  logger.info('  idx snap <url> [flags]          - inspect DOM at URL');
  logger.info('');
  logger.info('Flags:');
  logger.info('  --daemon                         Use persistent browser daemon (opt-in)');
  logger.info('  --cookies <browser>              Import all non-expired cookies from browser');
  logger.info('  --cookies <browser>:<d1>,<d2>    Import cookies for specific domains only');
  logger.info('  Supported browsers: chrome, arc, brave, edge, comet');
  logger.info('  Note: --cookies and --mode are stateless-mode flags; not supported with --daemon');
  logger.info('  --mode aria   Force ARIA accessibility tree (ariaSnapshot)');
  logger.info('  --mode dom    Force DOM simplifier + XPath');
  logger.info('  --mode auto   Auto-select based on quality (default)');
  logger.info('');
  logger.info('snap subcommand flags:');
  logger.info('  --aria                        - show ariaSnapshot (ARIA YAML) instead of DOM JSON');
  logger.info('  -i                            - interactive elements only');
  logger.info('  -a                            - annotated screenshot → /tmp/idx-dom-annotated.png');
  logger.info('  -d <N>                        - depth limit (dom mode only)');
  logger.info('  -s <selector>                 - scope to CSS selector subtree (dom mode only)');
  logger.info('');
  logger.info('Examples:');
  logger.info('  idx "url: https://example.com\\ninstructions:\\n  - click submit button"');
  logger.info('  idx --cookies chrome "url: https://github.com\\ninstructions:\\n  - get repo list"');
  logger.info('  idx --mode dom "url: https://canvas-app.example.com\\ninstructions:\\n  - click submit"');
  logger.info('  idx snap https://example.com -i -d 5');
  logger.info('  idx snap --aria https://example.com');
  logger.info('  idx snap --aria -i https://example.com');
  logger.info('');
  logger.info('Configuration:');
  logger.info('  AI_PROVIDER      - AI provider (openai, anthropic, google) [default: openai]');
  logger.info('  AI_TEMPERATURE   - AI temperature 0-2 [default: 0]');
  logger.info('  BROWSER_HEADLESS - Launch browser headless (true/false) [default: false]');
  logger.info('  BROWSER_SLOWMO   - Slow down browser actions (ms) [default: 100]');
  logger.info('  IDX_DAEMON       - Enable daemon mode (true/false) [default: false]');
  logger.info('  IDX_STATE_FILE   - Override daemon state file path [default: ~/.idx/server.json]');
  logger.info('');
  logger.info('See .env.example for all available configuration options');
}

async function run() {
  logger.info('Starting idx (Intent Driven eXtractor)');

  try {
    // Daemon mode routing — must come before any stateless setup
    const rawArgs = process.argv.slice(2);
    const daemonMode =
      process.env.IDX_DAEMON === 'true' || rawArgs.includes('--daemon');

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
    const { args, mode } = parseCliFlags();
    process.argv = savedArgv;

    // Validate command line arguments (after stripping --cookies and --mode)
    if (!args[0]) {
      logger.error('No user prompt provided');
      printUsage();
      process.exit(1);
    }

    if (args[0] === '--help' || args[0] === '-h') {
      printUsage();
      process.exit(0);
    }

    // Subcommand: idx snap <url> [flags] — no AI provider needed; dispatch early
    if (process.argv[2] === 'snap') {
      const domArgs = process.argv.slice(3);
      try {
        const browserConfig = getBrowserConfig();
        await runDomCommand(domArgs, browserConfig);
      } catch (err) {
        logger.error('snap subcommand failed', { error: err.message });
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
    const browserConfig = getBrowserConfig();
    const operationOptions = getOperationOptions(mode);

    logger.debug('Browser configuration', { ...browserConfig, channel: browserConfig.channel || 'default' });
    logger.debug('Operation options', operationOptions);

    // Launch the browser
    logger.info('Launching browser');
    const browser = await chromium.launch(browserConfig);

    try {
      // Create a new browser context and page
      const context = await browser.newContext();

      // Import cookies into context if --cookies was specified
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
          logger.error(`Cookie import failed: ${err.message}`, { code: err.code });
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

      // Get user prompt from remaining CLI args (after stripping --cookies and --mode)
      const userPrompt = args[0];

      // Parse task description
      logger.info('Parsing task description');
      let taskDescription;

      try {
        taskDescription = await operations.parseTaskDescription(userPrompt);
      } catch (error) {
        logger.error('Failed to parse task description:', {
          error: error.message,
          suggestion: 'Check that your prompt format is correct and try again'
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
        logger.error('Task execution failed', {
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
