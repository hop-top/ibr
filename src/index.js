import dotenv from 'dotenv';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { createAIProvider } from './ai/provider.js';
import { Operations } from './Operations.js';
import { validateEnvironmentVariables, validateBrowserConfig } from './utils/validation.js';
import logger from './utils/logger.js';
import { importCookies, getSupportedCookieBrowsersHelpText } from './utils/cookieImport.js';
import { runDomCommand } from './commands/snap.js';
import { loadAndBuildPrompt, listTools, parseToolArgs } from './commands/tool.js';
import { wsmAdapter } from './services/WsmAdapter.js';
import { infraManager } from './browser/resolvers/InfraManager.js';
import { CliError, ensureCliError, serializeCliError } from './utils/cliErrors.js';
import { fatalExit } from './utils/fatalExit.js';
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
 * @param {boolean} interactive - Force non-headless if true
 * @returns {Object} Browser configuration
 */
function getBrowserConfig(interactive = false) {
  let headless = process.env.BROWSER_HEADLESS?.toLowerCase() !== 'false';
  if (interactive) {
    headless = false;
  }
  const slowMo = parseInt(process.env.BROWSER_SLOWMO || '100', 10);
  const timeout = parseInt(process.env.BROWSER_TIMEOUT || '30000', 10);
  // Channel, executablePath, and BROWSER_ARGS are resolved by
  // src/browser/resolver.js from the env at dispatch time.
  return validateBrowserConfig({ headless, slowMo, timeout });
}

function emitStructuredError(error) {
  fs.writeSync(process.stderr.fd, `\n${JSON.stringify(serializeCliError(error))}\n`);
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

function normalizePromptUrl(candidate) {
  if (!candidate) return null;

  const cleaned = String(candidate).trim().replace(/^[("'[]+|['")\].,!?;:]+$/g, '');
  if (!cleaned) return null;

  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }

  if (/^(?:www\.)?[a-z0-9.-]+\.(?:com|org|net|io|dev|app|co)(?:\/\S*)?$/i.test(cleaned)) {
    return `https://${cleaned}`;
  }

  return null;
}

function extractTargetUrlFromPrompt(prompt) {
  const structuredMatch = prompt.match(/^\s*url\s*:\s*(\S+)/im);
  const structuredUrl = normalizePromptUrl(structuredMatch?.[1]);
  if (structuredUrl) return structuredUrl;

  const absoluteUrlMatch = prompt.match(/\bhttps?:\/\/[^\s'")\]]+/i);
  const absoluteUrl = normalizePromptUrl(absoluteUrlMatch?.[0]);
  if (absoluteUrl) return absoluteUrl;

  const hostnameMatch =
    prompt.match(/\b(?:www\.[^\s'")\]]+|[a-z0-9.-]+\.(?:com|org|net|io|dev|app|co)(?:\/[^\s'")\]]*)?)/i);
  return normalizePromptUrl(hostnameMatch?.[0]);
}

const VALID_MODES = new Set(['aria', 'dom', 'auto', 'visual']);

/**
 * Parse CLI flags from argv.
 * Strips recognised flags and returns remaining positional args + parsed options.
 * @returns {{ args: string[], mode: 'aria'|'dom'|'auto'|'visual', annotate: boolean, obeyRobots: boolean, ignoreAugmentations: boolean, interactive: boolean, quiet: boolean, output: ({ path: string, format: 'json'|'markdown' } | null) }}
 */
function parseCliFlags() {
  const argv = process.argv.slice(2);
  const remaining = [];
  let mode = 'auto';
  let annotate = false;
  let obeyRobots = process.env.OBEY_ROBOTS === 'true';
  let ignoreAugmentations = false;
  let interactive = false;
  let quiet = false;

  // Validate + parse the output-file surface once, up front, so an invalid
  // --output-format fails fast with a CONFIG_ERROR before browser launch.
  const output = parseOutputFlags(argv);

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--quiet' || argv[i] === '-q') {
      quiet = true;
    } else if (argv[i] === '--mode' && argv[i + 1]) {
      const val = argv[++i].toLowerCase();
      if (!VALID_MODES.has(val)) {
        logger.error(
          `Invalid --mode value: "${val}". Must be one of: aria, dom, auto, visual. ` +
          `Use "aria" to force accessibility tree, "dom" for XPath-based DOM, "auto" (default) to let ibr choose based on page quality, or "visual" for screenshot + Set-of-Marks.`
        );
        process.exit(1);
      }
      mode = val;
    } else if ((argv[i] === '--output' || argv[i] === '-o') && argv[i + 1]) {
      // Consume the flag + its path value so it never lands in positionals.
      i++;
    } else if (argv[i] === '--output-format' && argv[i + 1]) {
      // Consume the flag + its format value (already validated above).
      i++;
    } else if (argv[i] === '--annotate' || argv[i] === '-a') {
      annotate = true;
    } else if (argv[i] === '--interactive' || argv[i] === '-i') {
      interactive = true;
    } else if (argv[i] === '--obey-robots') {
      obeyRobots = true;
    } else if (argv[i] === '--raw' || argv[i] === '--ignore-augmentations') {
      ignoreAugmentations = true;
    } else {
      remaining.push(argv[i]);
    }
  }

  return { args: remaining, mode, annotate, obeyRobots, ignoreAugmentations, interactive, quiet, output };
}

/**
 * Get operation options from environment + CLI flags
 * @param {string} mode - mode from CLI flags
 * @param {boolean} annotate - annotate mode from CLI flags
 * @param {boolean} ignoreAugmentations - ignore augmentations from CLI flags
 * @returns {Object} Operation options
 */
export function getOperationOptions(mode, annotate = false, ignoreAugmentations = false, quiet = false) {
  const temperature = parseFloat(process.env.AI_TEMPERATURE || '0');

  if (isNaN(temperature) || temperature < 0 || temperature > 2) {
    throw new Error(
      'AI_TEMPERATURE must be a number between 0 and 2 (got: ' + process.env.AI_TEMPERATURE + '). ' +
      'Set AI_TEMPERATURE=0 for deterministic outputs or up to 2 for more creative responses. ' +
      'Remove the env var to use the default (0).'
    );
  }

  return { temperature, mode, annotate, ignoreAugmentations, quiet };
}

const VALID_OUTPUT_FORMATS = new Set(['json', 'markdown']);

/**
 * Parse the output-file flags from an argv slice (positional args, no node/script).
 *
 * Forms:
 *   --output <path>                       → { path, format: 'json' }
 *   -o <path>                             → { path, format: 'json' }
 *   --output <path> --output-format markdown → { path, format: 'markdown' }
 *
 * The written file is the sink a tlc flow `run.ibr` step consumes via
 * `${step.output.path}` (story 072). This is additive: it does not replace the
 * existing stdout/stderr extraction sink.
 *
 * Returns null when no output flag is present. Throws a CONFIG_ERROR CliError
 * for a missing value or an unknown format.
 *
 * @param {string[]} argv  positional args (already stripped of node + script)
 * @returns {{ path: string, format: 'json'|'markdown' } | null}
 */
export function parseOutputFlags(argv) {
  let outPath = null;
  let format = 'json';

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output' || argv[i] === '-o') {
      const val = argv[i + 1];
      if (!val || val.startsWith('-')) {
        throw new CliError(
          'CONFIG_ERROR',
          `${argv[i]} flag requires a path value. ` +
          'Usage: --output <path> [--output-format json|markdown]. ' +
          'Example: --output /tmp/flow/article.md --output-format markdown.'
        );
      }
      outPath = val;
      i++;
    } else if (argv[i] === '--output-format') {
      const val = argv[i + 1];
      if (!val || val.startsWith('-')) {
        throw new CliError(
          'CONFIG_ERROR',
          '--output-format flag requires a value (json or markdown). ' +
          'Usage: --output <path> --output-format json|markdown.'
        );
      }
      format = val.toLowerCase();
      i++;
    }
  }

  if (outPath === null) return null;

  if (!VALID_OUTPUT_FORMATS.has(format)) {
    throw new CliError(
      'CONFIG_ERROR',
      `Invalid --output-format value: "${format}". ` +
      `Must be one of: ${[...VALID_OUTPUT_FORMATS].join(', ')}. ` +
      'Use "json" (default) for the raw extraction, or "markdown" for a readable rendering.'
    );
  }

  return { path: outPath, format };
}

/**
 * Render the extraction result to a string in the requested format.
 *
 * `extracts` is the Operations.extracts shape: an array (one entry per
 * instruction) of arrays of `{ field: value }` objects.
 *
 *   json     → pretty-printed JSON of the raw extracts (round-trippable).
 *   markdown → a deterministic, readable rendering: one `## field` heading per
 *              extracted field, its value in the body. Multi-line string values
 *              are preserved. Non-string values are JSON-encoded in a fenced
 *              block so the output stays valid markdown.
 *
 * @param {Array} extracts  Operations.extracts
 * @param {'json'|'markdown'} format
 * @returns {string}
 */
export function renderExtraction(extracts, format) {
  if (format === 'json') {
    return JSON.stringify(extracts, null, 2);
  }

  // markdown — flatten the array-of-arrays into ordered {field, value} pairs.
  const sections = [];
  for (const group of Array.isArray(extracts) ? extracts : []) {
    for (const item of Array.isArray(group) ? group : [group]) {
      if (item && typeof item === 'object') {
        for (const [field, value] of Object.entries(item)) {
          sections.push({ field, value });
        }
      } else if (item != null) {
        sections.push({ field: null, value: item });
      }
    }
  }

  if (sections.length === 0) {
    return '# Extraction\n\n_No data extracted._\n';
  }

  const lines = ['# Extraction', ''];
  for (const { field, value } of sections) {
    if (field !== null) {
      lines.push(`## ${field}`, '');
    }
    if (typeof value === 'string') {
      lines.push(value, '');
    } else {
      lines.push('```json', JSON.stringify(value, null, 2), '```', '');
    }
  }
  return lines.join('\n');
}

/**
 * Write the extraction to `cfg.path` in `cfg.format`, creating parent dirs as
 * needed. Returns the `{ path, format }` contract the flow step emits so the
 * next step can resolve `${step.output.path}`.
 *
 * @param {{ path: string, format: 'json'|'markdown' }} cfg
 * @param {Array} extracts  Operations.extracts
 * @returns {{ path: string, format: 'json'|'markdown' }}
 */
export function writeExtractionOutput(cfg, extracts) {
  const dir = path.dirname(cfg.path);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cfg.path, renderExtraction(extracts, cfg.format), 'utf8');
  return { path: cfg.path, format: cfg.format };
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
    '  ibr [--cookies <browser>[:<domain,...>]] [--mode aria|dom|auto|visual] [--annotate] "<user_prompt>"',
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
    '  --mode visual Screenshot + Set-of-Marks; last-resort / vision-based',
    '  --raw, --ignore-augmentations   Skip domain-specific augmentations',
    '  --output <path>, -o <path>   Write the extraction to <path> (parent dirs auto-created)',
    '  --output-format json|markdown   Output file format [default: json]',
    '  --quiet, -q                  Suppress per-instruction progress feedback on stderr',
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
    '  # Show browser (non-headless)',
    '  BROWSER_HEADLESS=false ibr "url: https://example.com',
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
    '  BROWSER_HEADLESS      - Run headless (true/false) [default: true]',
    '  BROWSER_ARGS          - Extra Chromium launch args (space-separated)',
    '  BROWSER_REUSE_PAGE    - Reuse existing page in CDP-connected browser (true/false)',
    '  --interactive, -i     - Run in interactive mode (show browser, enable HITM)',
    '  BROWSER_SLOWMO        - Slow down actions (ms) [default: 100]',
    '  VISUAL_AI_MODEL       - AI model for visual mode (overrides AI_MODEL) [default: AI_MODEL]',
    '  VISUAL_MAX_ESCALATIONS - Max auto-escalation steps to visual (--mode auto only) [default: 3]',
    '  VISUAL_GRID           - Fallback grid dimensions for visual mode (RxC format) [default: 8x8]',
    '',
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

    // Parse CLI flags (--mode, --output, …) from the already-stripped argv
    // (no --cookies). parseCliFlags reads process.argv, so we temporarily shadow
    // it. An invalid --output-format surfaces here as a CONFIG_ERROR.
    const savedArgv = process.argv;
    process.argv = ['node', 'src/index.js', ...effectiveArgv.slice(2)];
    let args, mode, annotate, obeyRobots, ignoreAugmentations, interactive, quiet, output;
    try {
      ({ args, mode, annotate, obeyRobots, ignoreAugmentations, interactive, quiet, output } = parseCliFlags());
    } catch (err) {
      process.argv = savedArgv;
      const cliError = ensureCliError(err, 'CONFIG_ERROR');
      logger.error(cliError.message);
      emitStructuredError(cliError);
      process.exit(1);
    }
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

    const targetUrl = extractTargetUrlFromPrompt(prompt);
    if (targetUrl) {
      process.env.TARGET_URL = targetUrl;
    }

    // robots.txt compliance check (opt-in via --obey-robots or OBEY_ROBOTS=true)
    if (obeyRobots && targetUrl) {
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

    // Get browser and operation configuration before any AI calls so
    // invalid local config fails before provider auth or prompt parsing.
    logger.debug('Loading configuration');
    let browserConfig;
    let operationOptions;
    try {
      browserConfig = getBrowserConfig(interactive);
      operationOptions = getOperationOptions(mode, annotate, ignoreAugmentations, quiet);
    } catch (err) {
      logger.error(err.message);
      emitStructuredError(ensureCliError(err, 'CONFIG_ERROR'));
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
    const ops = new Operations({ aiProvider }, operationOptions);

    const executionTimeoutMs = parseExecutionTimeoutMs();

    logger.debug('Browser configuration', { ...browserConfig, channel: browserConfig.channel || 'default' });
    logger.debug('Operation options', operationOptions);

    // Initialize InfraManager before resolving browser to enable proactive routing
    await infraManager.init();

    // Launch the browser via the browser-manager subsystem.
    logger.info('Launching browser');
    const browserHandle = await resolveBrowser({ ...process.env }, browserConfig);
    const browser = browserHandle.browser;

    try {
      // Reuse existing context for CDP-connected browsers; create new otherwise
      const context = browserHandle.context
        ?? browser.contexts()[0]
        ?? await browser.newContext();

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
            `Check that the browser is installed and the platform key store is accessible.`,
            { code: err.code }
          );
          // Non-fatal — continue without session cookies
        }
      }

      const reusePage = process.env.BROWSER_REUSE_PAGE?.toLowerCase() === 'true';
      const existingPages = reusePage ? context.pages() : [];
      const tabIndex = parseInt(process.env.BROWSER_TAB_INDEX || '0', 10);
      const page = existingPages.length > tabIndex
        ? existingPages[tabIndex]
        : await context.newPage();

      // Update operations with real handle/page
      ops.ctx.page = page;
      ops.ctx.browserHandle = browserHandle;
      ops.domSimplifier.page = page;
      ops.annotationService.page = page;
      // --mode visual (vision-mode): VisualRepresenter is constructed in the
      // Operations constructor before this real page exists (ctx.page is
      // undefined there), and it holds its OWN AnnotationService instance
      // (not ops.annotationService) — so it needs the same page-patch the
      // two lines above already do for domSimplifier/annotationService, or
      // every visual capture throws reading .locator on an undefined page.
      ops.visualRepresenter.page = page;
      ops.visualRepresenter.annotationService.page = page;

      // Attach popup listener now that context is available
      context.on('page', (newPage) => {
        ops._pendingPopup = newPage;
        logger.debug('Popup detected via context event', {
          url: newPage.url(),
        });
      });
      ops.dialogManager.page = page;

      logger.info('Parsing task description');
      let taskDescription;

      try {
        taskDescription = await ops.parseTaskDescription(prompt);
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

      if (taskDescription?.url) {
        process.env.TARGET_URL = taskDescription.url;
      }

      // Execute task
      try {
        logger.info('Starting task execution');
        if (executionTimeoutMs == null) {
          await ops.executeTask(taskDescription);
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
            await Promise.race([ops.executeTask(taskDescription), timeoutPromise]);
          } finally {
            clearTimeout(timeoutId);
          }
        }

        logger.info('Task execution completed');
        logger.info(`Extracted data:\n${JSON.stringify(ops.extracts, null, 2)}`);

        // Additive file sink: if --output was set, write the extraction to a
        // consumable file (the tlc flow `run.ibr` step resolves this path via
        // `${step.output.path}`). Does not replace the stdout/stderr sink above.
        if (output) {
          try {
            const meta = writeExtractionOutput(output, ops.extracts);
            logger.info(`Wrote extraction to ${meta.path} (${meta.format})`);
          } catch (writeErr) {
            throw new CliError(
              'RUNTIME_ERROR',
              `Failed to write extraction to ${output.path}: ${writeErr.message} ` +
              'Check the path is writable and its parent is a directory, not a file.',
              { cause: writeErr }
            );
          }
        }

        // Report token usage
        logger.info('Token usage summary', {
          promptTokens: ops.tokenUsage.prompt,
          completionTokens: ops.tokenUsage.completion,
          totalTokens: ops.tokenUsage.total
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
    // Any failure inside run() (browser launch/acquire included) surfaces
    // here. fatalExit guarantees a non-empty stderr message + flushed stdio
    // BEFORE process.exit, so a launch failure can never be a silent 0-byte
    // exit on a piped/backpressured stream (T-0109).
    const cliError = ensureCliError(error, 'RUNTIME_ERROR');
    await fatalExit(logger, cliError, { code: cliError.code, message: 'Fatal error' });
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
  run().catch(async error => {
    const cliError = ensureCliError(error, 'RUNTIME_ERROR');
    // Swallow any residual rejection: in production process.exit never
    // returns, but a test stub can make it throw — that must not become a
    // dangling unhandled rejection at the entry point.
    try {
      await fatalExit(logger, cliError, {
        code: cliError.code,
        message: 'Unhandled error in main',
      });
    } catch { /* process.exit stubbed to throw (tests) — already surfaced */ }
  });
}
