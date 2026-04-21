import dotenv from 'dotenv';
import { once } from 'node:events';
import fs from 'node:fs';
import { createAIProvider } from './ai/provider.js';
import { Operations } from './Operations.js';
import { validateEnvironmentVariables, validateBrowserConfig } from './utils/validation.js';
import logger from './utils/logger.js';
import { importCookies, getSupportedCookieBrowsersHelpText } from './utils/cookieImport.js';
import { runDomCommand } from './commands/snap.js';
import { loadAndBuildPrompt, listTools, parseToolArgs } from './commands/tool.js';
import { wsmAdapter } from './services/WsmAdapter.js';
import { CliError, ensureCliError, serializeCliError } from './utils/cliErrors.js';
import { createUpgrader } from './utils/upgrader.js';
import { resolveBrowser } from './browser/index.js';
import { checkRobots } from './utils/robotsCheck.js';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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
  // Channel + executablePath are resolved by src/browser/resolver.js from
  // the env (BROWSER_CHANNEL / BROWSER_EXECUTABLE_PATH).
  return validateBrowserConfig({ headless, slowMo, timeout });
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
 * @returns {{ args: string[], mode: 'aria'|'dom'|'auto', annotate: boolean, obeyRobots: boolean }}
 */
function parseCliFlags() {
  const argv = process.argv.slice(2);
  const remaining = [];
  let mode = 'auto';
  let annotate = false;
  let obeyRobots = process.env.OBEY_ROBOTS === 'true';

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
    } else if (argv[i] === '--obey-robots') {
      obeyRobots = true;
    } else {
      remaining.push(argv[i]);
    }
  }

  return { args: remaining, mode, annotate, obeyRobots };
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
 * Print usage information — plain text, no logger formatting.
 * Writes to `stream` (default: stdout so `ibr --help | less` works).
 */
function printUsage(stream = process.stdout) {
  const lines = [
    'ibr - Intent Browser Runtime',
    '',
    'Usage:',
    '  ibr [--cookies <browser>[:<domain,...>]] [--mode aria|dom|auto] [--annotate] "<user_prompt>"',
    '  ibr [--daemon] "<user_prompt>"  - use persistent daemon (faster warm invocations)',
    '  ibr snap <url> [flags]          - inspect DOM at URL',
    '  ibr tool <name> [--param k=v]   - run a YAML-defined tool',
    '  ibr tool --list                 - list available tools',
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
    '  --obey-robots                Check robots.txt before running; abort if path is disallowed',
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
    '',
    '  # Basic navigation + action',
    '  ibr "url: https://example.com',
    '  instructions:',
    '    - click the submit button"',
    '',
    '  # Extract data',
    '  ibr "url: https://news.ycombinator.com',
    '  instructions:',
    '    - extract the top 5 story titles and their scores"',
    '',
    '  # Authenticated session (import cookies from Chrome)',
    '  ibr --cookies chrome "url: https://github.com',
    '  instructions:',
    '    - list my open pull requests"',
    '',
    '  # Use Brave browser',
    '  BROWSER_CHANNEL=brave ibr "url: https://example.com',
    '  instructions:',
    '    - click login"',
    '',
    '  # Use Brave + its cookies',
    '  BROWSER_CHANNEL=brave ibr --cookies brave "url: https://example.com',
    '  instructions:',
    '    - get my account name"',
    '',
    '  # Headless mode (CI/scripts)',
    '  BROWSER_HEADLESS=true ibr "url: https://example.com',
    '  instructions:',
    '    - extract the page title"',
    '',
    '  # Multi-step form fill',
    '  ibr "url: https://example.com/signup',
    '  instructions:',
    '    - fill the email field with test@example.com',
    '    - fill the password field with hunter2',
    '    - click the sign up button',
    '    - extract the confirmation message"',
    '',
    '  # DOM inspection (no AI, no browser session)',
    '  ibr snap https://example.com -i -d 5',
    '  ibr snap --aria https://example.com',
    '',
    'Configuration:',
    '  AI_PROVIDER           - AI provider: openai, anthropic, google [default: openai]',
    '  AI_MODEL              - Override model (e.g. gpt-4.1, claude-opus-4-6)',
    '  AI_TEMPERATURE        - AI temperature 0-2 [default: 0]',
    '  BROWSER_CHANNEL       - Browser to use: brave, chrome, msedge, chromium, arc, comet',
    '  BROWSER_EXECUTABLE_PATH - Explicit path to browser binary (overrides BROWSER_CHANNEL)',
    '  BROWSER_PROFILE       - Browser profile for cookie import [default: Default]',
    '  BROWSER_HEADLESS      - Run headless (true/false) [default: false]',
    '  BROWSER_SLOWMO        - Slow down actions (ms) [default: 100]',
    '  OBEY_ROBOTS           - Check robots.txt before automation (true/false) [default: false]',
    '  IBR_DAEMON            - Enable daemon mode (true/false) [default: false]',
    '  IBR_STATE_FILE        - Daemon state file path [default: ~/.ibr/server.json]',
    '',
    'See .env.example for all available configuration options',
  ];
  stream.write(lines.join('\n') + '\n');
}


async function run() {
  const rawArgs = process.argv.slice(2);

  // Subcommand: ibr browser <subcmd> — dispatch early, no banner, no AI setup.
  // Must run BEFORE the global --help short-circuit so per-subcommand --help works.
  if (rawArgs[0] === 'browser') {
    try {
      const browserCmd = await import('./commands/browser/index.js');
      const code = await browserCmd.run(rawArgs.slice(1));
      process.exit(code ?? 0);
    } catch (err) {
      const cliError = ensureCliError(err, 'RUNTIME_ERROR');
      process.stderr.write(`ibr browser: ${cliError.message}\n`);
      emitStructuredError(cliError);
      process.exit(1);
    }
  }
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
        printUsage(prompt ? process.stdout : process.stderr);
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
      printUsage(process.stderr);
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
    const { args, mode, annotate, obeyRobots } = parseCliFlags();
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
      printUsage(process.stderr);
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
      const domArgs = process.argv.slice(3).filter(a => a !== '--obey-robots');
      const snapObeyRobots =
        process.env.OBEY_ROBOTS === 'true' || process.argv.slice(3).includes('--obey-robots');
      try {
        // Parse args early to catch missing URL/invalid flags before launching browser
        const snapOpts = await import('./commands/snap.js').then(m => m.parseDomArgs(domArgs));

        if (snapObeyRobots && snapOpts.url) {
          const robotsResult = await checkRobots(snapOpts.url);
          if (!robotsResult.allowed) {
            const error = new CliError(
              'ROBOTS_DISALLOWED',
              `Target URL is disallowed by robots.txt: ${snapOpts.url}. ` +
              'Remove --obey-robots to bypass this check, or target a different URL.'
            );
            logger.error(error.message);
            emitStructuredError(error);
            process.exit(1);
          }
        }

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

    // Subcommand: ibr tool <name> [--param k=v ...] — load YAML, interpolate, run
    if (process.argv[2] === 'tool') {
      const toolArgs = process.argv.slice(3);

      // ibr tool --list
      if (toolArgs[0] === '--list' || toolArgs[0] === '-l') {
        const tools = listTools();
        if (tools.length === 0) {
          process.stdout.write('No tools available.\n');
        } else {
          process.stdout.write('Available tools:\n');
          for (const t of tools) {
            process.stdout.write(`  ${t}\n`);
          }
        }
        return;
      }

      const toolName = toolArgs[0];
      if (!toolName || toolName.startsWith('--')) {
        const error = new CliError(
          'CONFIG_ERROR',
          'ibr tool requires a tool name. ' +
          'Usage: ibr tool <name> [--param key=value ...]. ' +
          'Run "ibr tool --list" to see available tools.'
        );
        logger.error(error.message);
        emitStructuredError(error);
        process.exit(1);
      }

      let toolPrompt;
      try {
        const { params } = parseToolArgs(toolArgs.slice(1));
        const { prompt } = loadAndBuildPrompt(toolName, params);
        toolPrompt = prompt;
      } catch (err) {
        logger.error(err.message);
        emitStructuredError(ensureCliError(err, 'CONFIG_ERROR'));
        process.exit(1);
      }

      // Re-inject the resolved prompt back into the execution flow by
      // overwriting the prompt variable and falling through to normal execution.
      prompt = toolPrompt;
    }

    // Static prompt pre-validation — fail fast before browser launch.
    // Accepts structured "url: ..." format OR natural-language prompts that
    // contain an inferable URL (https?:// or bare hostname with TLD).
    const hasStructuredUrl = /^\s*url\s*:/m.test(prompt);
    const hasInferableUrl = /https?:\/\/\S+/.test(prompt) || /\b(?:www\.\S+|\S+\.(?:com|org|net|io|dev|app|co)\b)/.test(prompt);
    if (!hasStructuredUrl && !hasInferableUrl) {
      const error = new CliError(
        'CONFIG_ERROR',
        'Prompt must include a URL. ' +
        'Example: "url: https://example.com\\ninstructions:\\n  - click submit" ' +
        'or "go to https://example.com and extract the title". ' +
        'Run "ibr --help" for full usage.'
      );
      logger.error(error.message);
      emitStructuredError(error);
      process.exit(1);
    }

    // robots.txt compliance check (opt-in via --obey-robots or OBEY_ROBOTS=true)
    if (obeyRobots) {
      const urlMatch = prompt.match(/https?:\/\/\S+/);
      const targetUrl = urlMatch ? urlMatch[0].replace(/['")\]]+$/, '') : null;
      if (targetUrl) {
        const robotsResult = await checkRobots(targetUrl);
        if (!robotsResult.allowed) {
          const error = new CliError(
            'ROBOTS_DISALLOWED',
            `Target URL is disallowed by robots.txt: ${targetUrl}. ` +
            'Remove --obey-robots to bypass this check, or target a different URL.'
          );
          logger.error(error.message);
          emitStructuredError(error);
          process.exit(1);
        }
      }
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

    // Launch the browser via the browser-manager subsystem.
    logger.info('Launching browser');
    const browserHandle = await resolveBrowser(process.env, browserConfig);
    const browser = browserHandle.browser;

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
          const profile = process.env.BROWSER_PROFILE || 'Default';
          const result = await importCookies(cookiesConfig.browser, cookiesConfig.domains, profile);
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
      // Close the browser via the handle so the launcher can clean up
      // any subprocess (CDP server, lightpanda, etc.) it spawned.
      logger.debug('Closing browser');
      await browserHandle.close();
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

// Only auto-run when invoked directly as a CLI (not imported as a module).
// In a SEA binary, import.meta.url is shimmed by esbuild and does not match
// process.argv[1]. Detect SEA via node:sea and always run in that context.
// NOTE: bare `require()` is not defined in ESM modules; must use the
// `_require` created via createRequire at the top of this file.
let _isSea = false;
try { _isSea = _require('node:sea').isSea(); } catch (_) {}
const _isMain = _isSea || (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]));
if (_isMain) {
  run().catch(error => {
    const cliError = ensureCliError(error, 'RUNTIME_ERROR');
    logger.error('Unhandled error in main', { error: cliError.message });
    emitStructuredError(cliError);
    process.exit(1);
  });
}
