/**
 * Daemon server — persistent browser process.
 * Lifecycle: launch browser → create AI+Operations → HTTP server on random port →
 * write state file → idle-check interval → signal handlers for clean shutdown.
 */

import http from 'http';
import { createHash, randomUUID } from 'crypto';
import { writeFile, unlink, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

import { chromium } from 'playwright';
import { createAIProvider } from './ai/provider.js';
import { Operations } from './Operations.js';
import { validateBrowserConfig } from './utils/validation.js';
import logger from './utils/logger.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _stateFile =
  process.env.IBR_STATE_FILE ||
  path.join(os.homedir(), '.ibr', 'server.json');
const STATE_DIR = path.dirname(_stateFile);
const STATE_FILE = _stateFile;
const IDLE_CHECK_INTERVAL_MS = 60_000;
const IDLE_TIMEOUT_MS = 30 * 60_000; // 30 min

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let browser = null;
let operations = null;
let serverToken = null;
let startedAt = Date.now();
let lastActivityAt = Date.now();
let httpServer = null;

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

function getBrowserConfig() {
  const headless = process.env.BROWSER_HEADLESS?.toLowerCase() !== 'false'; // default true for daemon
  const slowMo = parseInt(process.env.BROWSER_SLOWMO || '100', 10);
  const timeout = parseInt(process.env.BROWSER_TIMEOUT || '30000', 10);
  return validateBrowserConfig({ headless, slowMo, timeout, channel: process.env.BROWSER_CHANNEL });
}

function getOperationOptions() {
  const temperature = parseFloat(process.env.AI_TEMPERATURE || '0');
  if (isNaN(temperature) || temperature < 0 || temperature > 2) {
    throw new Error(
      'AI_TEMPERATURE must be a number between 0 and 2 (got: ' + process.env.AI_TEMPERATURE + '). ' +
      'Set AI_TEMPERATURE=0 for deterministic outputs or up to 2 for more creative responses. ' +
      'Remove the env var to use the default (0).'
    );
  }
  return { temperature };
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

async function writeStateFile(port) {
  await mkdir(STATE_DIR, { recursive: true });
  const state = {
    pid: process.pid,
    port,
    token: serverToken,
    startedAt,
    serverPath: process.argv[1],
  };
  // Atomic write: temp file then rename
  const tmp = STATE_FILE + '.tmp.' + process.pid;
  await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
  try {
    const { rename } = await import('fs/promises');
    await rename(tmp, STATE_FILE);
  } catch {
    await writeFile(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
    try { await unlink(tmp); } catch { /* ignore */ }
  }
  logger.debug('State file written', { path: STATE_FILE, port, pid: process.pid });
}

async function removeStateFile() {
  try {
    await unlink(STATE_FILE);
  } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

async function shutdown(reason = 'signal') {
  logger.info('Shutting down daemon', { reason });
  if (idleTimer) clearInterval(idleTimer);
  await removeStateFile();
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    req.on('data', chunk => {
      totalLength += chunk.length;
      if (totalLength > MAX_BODY_BYTES) {
        // Stop accumulating; drain remaining data so the socket stays open
        // and the caller receives the 413 response rather than a connection reset.
        req.resume();
        reject(Object.assign(new Error('Request entity too large'), { code: 'ERR_BODY_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(String(text));
}

function checkAuth(req) {
  const auth = req.headers['authorization'] || '';
  const expected = `Bearer ${serverToken}`;
  // SHA-256 hex comparison is not truly constant-time (timingSafeEqual would be
  // stricter). This is intentional: the daemon is localhost-only and the token
  // lives in ~/.ibr/server.json (mode 0600, same UID). Any local attacker with
  // the ability to time loopback requests already has direct read access to the
  // token — timing side-channels add no meaningful attack surface here.
  // See: https://github.com/hop-top/ibr/pull/11#discussion_r2966992046
  if (auth.length !== expected.length) return false;
  return createHash('sha256').update(auth).digest('hex') ===
         createHash('sha256').update(expected).digest('hex');
}

async function handleRequest(req, res) {
  const { method, url } = req;

  // Health — no auth
  if (method === 'GET' && url === '/health') {
    sendJSON(res, 200, {
      status: 'healthy',
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      pid: process.pid,
    });
    return;
  }

  // Command — auth required
  if (method === 'POST' && url === '/command') {
    if (!checkAuth(req)) {
      sendJSON(res, 401, { error: 'Unauthorized' });
      return;
    }

    let body;
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch (err) {
      const status = err.code === 'ERR_BODY_TOO_LARGE' ? 413 : 400;
      sendJSON(res, status, {
        error: status === 413
          ? 'Request entity too large (limit: 1 MiB). Shorten your prompt.'
          : 'Invalid JSON body. POST must send {"command":"task","args":["<prompt>"]}.'
      });
      return;
    }

    if (body.command !== 'task' || !Array.isArray(body.args) || typeof body.args[0] !== 'string' || body.args[0].trim().length === 0) {
      sendJSON(res, 400, {
        error: 'Malformed request body. Expected {"command":"task","args":["<your prompt here>"]}.',
        hint: 'The "args" array must contain at least one non-empty string prompt.'
      });
      return;
    }

    lastActivityAt = Date.now();
    const prompt = body.args[0];

    try {
      logger.info('Executing command', { prompt: prompt.slice(0, 80) });

      let taskDescription;
      try {
        taskDescription = await operations.parseTaskDescription(prompt);
      } catch (err) {
        sendJSON(res, 500, {
          error: `Parse failed: ${err.message}`,
          hint: 'Ensure prompt includes "url:" and "instructions:" fields. Example: "url: https://example.com\\ninstructions:\\n  - click submit".',
        });
        return;
      }

      await operations.executeTask(taskDescription);

      const result = JSON.stringify({
        extracts: operations.extracts,
        tokenUsage: operations.tokenUsage,
      }, null, 2);

      // Reset per-command state so next command starts fresh
      operations.extracts = [];
      operations.tokenUsage = { prompt: 0, completion: 0, total: 0 };
      operations.executionIndex = 0;

      lastActivityAt = Date.now();
      sendText(res, 200, result);
    } catch (err) {
      logger.error('Command failed', { error: err.message });
      sendJSON(res, 500, {
        error: err.message,
        hint: 'Task execution failed. Check daemon logs for the failing instruction index and observability context. ' +
              'Run "ibr snap <url> -i" to inspect the page state before retrying.',
      });
    }
    return;
  }

  // Fallthrough
  sendJSON(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Idle check
// ---------------------------------------------------------------------------

let idleTimer = null;

function startIdleCheck() {
  idleTimer = setInterval(() => {
    const idle = Date.now() - lastActivityAt;
    if (idle >= IDLE_TIMEOUT_MS) {
      logger.info('Idle timeout reached, shutting down', { idleMs: idle });
      shutdown('idle');
    }
  }, IDLE_CHECK_INTERVAL_MS);
  idleTimer.unref(); // don't hold event loop open
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  logger.info('ibr daemon starting');

  // Validate env
  const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const apiKeyMap = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  };
  const requiredKey = apiKeyMap[provider];
  if (requiredKey && !process.env[requiredKey]) {
    logger.error(
      `Missing required env var: ${requiredKey}. ` +
      `Set ${requiredKey} in your environment or .env file. ` +
      `Current AI_PROVIDER is "${provider}". ` +
      `Supported providers: openai, anthropic, google.`
    );
    process.exit(1);
  }

  // Launch browser
  logger.info('Launching browser');
  const browserConfig = getBrowserConfig();
  browser = await chromium.launch(browserConfig);

  browser.on('disconnected', () => {
    logger.error(
      'Browser disconnected unexpectedly. ' +
      'The Chromium process may have crashed or been killed externally. ' +
      'Restart the daemon with "ibr --daemon" or check system resource limits.'
    );
    removeStateFile().finally(() => process.exit(1));
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Create AI + Operations
  const aiProvider = createAIProvider();
  const operationOptions = getOperationOptions();
  operations = new Operations({ aiProvider, page }, operationOptions);

  // Token
  serverToken = randomUUID();

  // HTTP server — listen on random port, localhost only
  httpServer = http.createServer(handleRequest);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.once('listening', resolve);
    httpServer.listen(0, '127.0.0.1');
  });

  const { port } = httpServer.address();
  logger.info('HTTP server listening', { port, pid: process.pid });

  // Write state file
  await writeStateFile(port);

  // Idle check
  startIdleCheck();

  // Signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('ibr daemon ready', { port, pid: process.pid });
}

main().catch(err => {
  logger.error(
    'Daemon startup failed. Check env vars (AI_PROVIDER, API key), Playwright installation, and available ports.',
    { error: err.message }
  );
  process.exit(1);
});
