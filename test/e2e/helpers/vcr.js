/**
 * VCR helper for CLI e2e tests — backed by @hop-top/xrr.
 *
 * Two modes:
 *
 * REPLAY (default) — loads cassette from disk and starts a
 * fake OpenAI-compatible server that replays responses.
 * Prefers xrr YAML cassettes (dir-based); falls back to
 * legacy JSON array cassettes for backward compat.
 *
 * RECORD (VCR_RECORD=true) — starts a passthrough proxy
 * that forwards requests to the real AI endpoint, captures
 * each response via xrr, and writes YAML cassettes on
 * close().
 *
 * Cassettes use {SERVER_URL} as a placeholder for the
 * static test server's base URL — substituted at load
 * time in replay mode.
 *
 * Usage (replay):
 *   const ai = await startFromCassette(
 *     'story-005-custom-model',
 *     { SERVER_URL: web.baseUrl }
 *   );
 *   await ai.close();
 *
 * Usage (record — run once, then commit cassettes):
 *   VCR_RECORD=true OPENAI_API_KEY=sk-... \
 *     node test/e2e/cli-tool-vcr.test.js
 */

import http from 'node:http';
import https from 'node:https';
import {
  readFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FileSession,
  FileCassette,
  HttpAdapter,
} from '@hop-top/xrr';
import {
  startFakeAIServerE2E,
} from '../../helpers/fakeAIServerE2E.js';

const CASSETTES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../cassettes',
);

// ─── Replay (xrr YAML) ───────────────────────────────

/**
 * Build the full URL that ibr would POST to, so the
 * HttpAdapter can fingerprint it consistently.
 */
function makeRequestUrl(baseUrl, path) {
  return `${baseUrl}${path}`;
}

/**
 * Start a replay server backed by xrr FileCassette.
 */
function startXrrReplayServer(cassetteDir, vars = {}) {
  const cassette = new FileCassette(cassetteDir);
  const session = new FileSession('replay', cassette);
  const adapter = new HttpAdapter();

  const server = http.createServer((req, res) => {
    const isPost = req.method === 'POST';
    const isApi =
      req.url === '/responses' ||
      req.url === '/v1/responses' ||
      req.url === '/v1/chat/completions' ||
      req.url === '/chat/completions';

    if (!isPost || !isApi) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      const port = server.address().port;
      const url = makeRequestUrl(
        `http://127.0.0.1:${port}`,
        req.url,
      );

      try {
        const resp = await session.record(
          adapter,
          { method: req.method, url, body },
          // never called in replay mode
          async () => ({ status: 500, body: '' }),
        );

        // Apply variable substitution to body
        let respBody = resp.body ?? '';
        for (const [k, v] of Object.entries(vars)) {
          respBody = respBody.replaceAll(`{${k}}`, v);
        }

        res.writeHead(
          resp.status,
          { 'Content-Type': 'application/json' },
        );
        res.end(respBody);
      } catch {
        res.writeHead(500, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({
          error: {
            message: 'xrr cassette miss',
            type: 'server_error',
            code: 'cassette_miss',
          },
        }));
      }
    });
  });

  return new Promise((ok, fail) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ok({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(r)),
      });
    });
    server.on('error', fail);
  });
}

// ─── Replay (legacy JSON) ────────────────────────────

function startLegacyReplayServer(name, vars = {}) {
  const jsonPath = resolve(CASSETTES_DIR, `${name}.json`);
  let raw = readFileSync(jsonPath, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    raw = raw.replaceAll(`{${key}}`, value);
  }
  const responses = JSON.parse(raw);
  return startFakeAIServerE2E(responses);
}

// ─── Record ──────────────────────────────────────────

/**
 * Start a recording proxy that saves xrr YAML cassettes.
 */
function startRecordingProxy(name, vars = {}) {
  const cassetteDir = resolve(CASSETTES_DIR, name);
  mkdirSync(cassetteDir, { recursive: true });

  const cassette = new FileCassette(cassetteDir);
  const session = new FileSession('record', cassette);
  const adapter = new HttpAdapter();

  const upstreamBase =
    process.env.OPENAI_BASE_URL_REAL ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com';
  const apiKey = process.env.OPENAI_API_KEY || '';

  /**
   * Replace actual values with placeholders.
   */
  function templateReplace(str) {
    let out = str;
    for (const [k, v] of Object.entries(vars)) {
      if (v) out = out.replaceAll(v, `{${k}}`);
    }
    return out;
  }

  const server = http.createServer((req, res) => {
    const isPost = req.method === 'POST';
    const isApi =
      req.url === '/responses' ||
      req.url === '/v1/responses' ||
      req.url === '/v1/chat/completions' ||
      req.url === '/chat/completions';

    if (!isPost || !isApi) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let reqBody = '';
    req.on('data', c => { reqBody += c; });
    req.on('end', async () => {
      const port = server.address().port;
      const localUrl = makeRequestUrl(
        `http://127.0.0.1:${port}`,
        req.url,
      );

      try {
        const resp = await session.record(
          adapter,
          { method: req.method, url: localUrl, body: reqBody },
          async () => {
            // Forward to upstream
            let path = req.url;
            if (
              upstreamBase.includes('openai.com') &&
              !path.startsWith('/v1/')
            ) {
              path = '/v1' + path;
            }
            const upstream = new URL(path, upstreamBase);
            const isHttps = upstream.protocol === 'https:';
            const transport = isHttps ? https : http;

            return new Promise((ok, fail) => {
              const opts = {
                hostname: upstream.hostname,
                port: upstream.port || (isHttps ? 443 : 80),
                path: upstream.pathname + upstream.search,
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`,
                  'Content-Length':
                    Buffer.byteLength(reqBody),
                },
              };

              const upReq = transport.request(opts, r => {
                let body = '';
                r.on('data', c => { body += c; });
                r.on('end', () => {
                  const templated = templateReplace(body);
                  ok({
                    status: r.statusCode,
                    headers: {
                      'content-type':
                        r.headers['content-type'] ||
                        'application/json',
                    },
                    body: templated,
                  });
                });
              });

              upReq.on('error', fail);
              upReq.write(reqBody);
              upReq.end();
            });
          },
        );

        res.writeHead(resp.status, {
          'Content-Type':
            resp.headers?.['content-type'] ||
            'application/json',
        });
        res.end(resp.body);
      } catch (err) {
        res.writeHead(502, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({
          error: {
            message: err.message,
            type: 'proxy_error',
          },
        }));
      }
    });
  });

  return new Promise((ok, fail) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ok({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => {
          server.close(() => {
            console.error(
              `[vcr] recorded xrr cassettes → ${cassetteDir}`,
            );
            r();
          });
        }),
      });
    });
    server.on('error', fail);
  });
}

// ─── Public API ──────────────────────────────────────

/**
 * Start a fake AI server replaying the named cassette.
 *
 * @param {string} name - Cassette name (no extension)
 * @param {Record<string, string>} [vars] - Placeholders
 * @returns {Promise<{
 *   baseUrl: string,
 *   close: () => Promise<void>
 * }>}
 */
export function startFromCassette(name, vars = {}) {
  if (process.env.VCR_RECORD === 'true') {
    return startRecordingProxy(name, vars);
  }

  // Prefer xrr YAML cassettes (dir-based)
  const xrrDir = resolve(CASSETTES_DIR, name);
  if (existsSync(xrrDir)) {
    return startXrrReplayServer(xrrDir, vars);
  }

  // Fall back to legacy JSON cassettes
  return startLegacyReplayServer(name, vars);
}
