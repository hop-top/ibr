/**
 * VCR helper for CLI e2e tests.
 *
 * Two modes:
 *
 * REPLAY (default) — loads a cassette from disk and starts a fake
 * OpenAI-compatible server that replays responses in order.
 *
 * RECORD (VCR_RECORD=true) — starts a passthrough proxy that forwards
 * requests to the real AI endpoint, captures each response content string,
 * and writes the cassette to disk on close(). Requires a real API key and
 * OPENAI_BASE_URL (or defaults to the real OpenAI endpoint).
 *
 * Cassettes use {SERVER_URL} as a placeholder for the static test server's
 * base URL — substituted at load time in replay mode.
 *
 * Usage (replay):
 *   const ai = await startFromCassette('story-005-custom-model', { SERVER_URL: web.baseUrl });
 *   await ai.close();
 *
 * Usage (record — run once, then commit the cassette):
 *   VCR_RECORD=true OPENAI_API_KEY=sk-... node test/e2e/cli-tool-vcr.test.js
 */

import http from 'node:http';
import https from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeAIServerE2E } from '../../helpers/fakeAIServerE2E.js';

const CASSETTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../cassettes');

// ─── Replay ──────────────────────────────────────────────────────────────────

/**
 * Start a fake AI server replaying the named cassette.
 *
 * @param {string} name - Cassette filename without extension
 * @param {Record<string, string>} [vars] - Placeholder substitutions
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
export function startFromCassette(name, vars = {}) {
  if (process.env.VCR_RECORD === 'true') {
    return startRecordingProxy(name, vars);
  }
  const path = resolve(CASSETTES_DIR, `${name}.json`);
  let raw = readFileSync(path, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    raw = raw.replaceAll(`{${key}}`, value);
  }
  const responses = JSON.parse(raw);
  return startFakeAIServerE2E(responses);
}

// ─── Record ──────────────────────────────────────────────────────────────────

/**
 * Start a passthrough proxy that records AI responses to a cassette file.
 *
 * The proxy intercepts POST /responses (OpenAI Responses API) and
 * POST /v1/chat/completions, forwards to the real upstream, captures the
 * content string from each response, and saves the cassette on close().
 *
 * URLs in the recorded content that contain the static server's baseUrl are
 * replaced with the {SERVER_URL} placeholder so the cassette is reusable.
 *
 * @param {string} name - Cassette name (file will be written to cassettes/<name>.json)
 * @param {Record<string, string>} [vars] - vars used to template-replace back
 *   (e.g. { SERVER_URL: 'http://127.0.0.1:PORT' })
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
function startRecordingProxy(name, vars = {}) {
  const upstreamBase = process.env.OPENAI_BASE_URL_REAL ||
    process.env.OPENAI_BASE_URL ||
    'https://api.openai.com';
  const apiKey = process.env.OPENAI_API_KEY || '';
  const recorded = [];

  /**
   * Extract the response content string from an OpenAI Responses API or
   * chat/completions payload.
   */
  function extractContent(body) {
    try {
      const parsed = JSON.parse(body);
      // Responses API format
      if (parsed.output?.[0]?.content?.[0]?.text !== undefined) {
        return parsed.output[0].content[0].text;
      }
      // Chat completions format
      if (parsed.choices?.[0]?.message?.content !== undefined) {
        return parsed.choices[0].message.content;
      }
    } catch { /* non-JSON */ }
    return body;
  }

  /**
   * Template-replace actual values with placeholders in a string.
   */
  function templateReplace(str) {
    let out = str;
    for (const [key, value] of Object.entries(vars)) {
      if (value) out = out.replaceAll(value, `{${key}}`);
    }
    return out;
  }

  const server = http.createServer((req, res) => {
    const isResponsesApi = req.method === 'POST' && req.url === '/responses';
    const isChatCompletions = req.method === 'POST' && req.url === '/v1/chat/completions';

    if (!isResponsesApi && !isChatCompletions) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let reqBody = '';
    req.on('data', chunk => { reqBody += chunk; });
    req.on('end', () => {
      // Build upstream URL
      const upstreamUrl = new URL(req.url, upstreamBase);
      const isHttps = upstreamUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const options = {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (isHttps ? 443 : 80),
        path: upstreamUrl.pathname + upstreamUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(reqBody),
        },
      };

      const upstreamReq = transport.request(options, upstreamRes => {
        let upstreamBody = '';
        upstreamRes.on('data', chunk => { upstreamBody += chunk; });
        upstreamRes.on('end', () => {
          // Record the content string with placeholders substituted back
          const content = extractContent(upstreamBody);
          recorded.push(templateReplace(content));

          // Forward response to ibr
          res.writeHead(upstreamRes.statusCode, {
            'Content-Type': upstreamRes.headers['content-type'] || 'application/json',
          });
          res.end(upstreamBody);
        });
      });

      upstreamReq.on('error', err => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message, type: 'proxy_error' } }));
      });

      upstreamReq.write(reqBody);
      upstreamReq.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => {
          server.close(() => {
            const cassettePath = resolve(CASSETTES_DIR, `${name}.json`);
            writeFileSync(cassettePath, JSON.stringify(recorded, null, 2) + '\n');
            console.error(`[vcr] recorded ${recorded.length} responses → ${cassettePath}`);
            r();
          });
        }),
      });
    });
    server.on('error', reject);
  });
}
