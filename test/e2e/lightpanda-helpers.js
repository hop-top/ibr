/**
 * Shared helpers for the gated lightpanda e2e suite.
 *
 * Track: adopt-lightpanda
 * Task:  T-0034
 *
 * These helpers are intentionally self-contained — they do NOT import
 * anything from src/ — so they can be used to set up an isolated cache
 * + static HTTP fixture without polluting the user's real
 * ~/.cache/ibr/browsers/ tree.
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_STATIC_DIR = path.resolve(__dirname, 'fixtures/static');

/**
 * Return whether the gated lightpanda e2e suite should run.
 *
 * Gate is opt-in via BROWSER_E2E=lightpanda. Always disabled on win32
 * since lightpanda is not supported upstream there.
 *
 * @returns {boolean}
 */
export function isE2EEnabled() {
  if (process.platform === 'win32') return false;
  return process.env.BROWSER_E2E === 'lightpanda';
}

/**
 * Create a temporary cache root suitable for the lightpanda browser
 * manager. Returns the cache dir (the ibr/browsers root used by
 * cache.cacheRoot() when XDG_CACHE_HOME is set), an env object that
 * points XDG_CACHE_HOME at the temp tree, and a cleanup() function.
 *
 * Usage:
 *   const tmp = makeTempCache();
 *   try {
 *     const handle = await resolveBrowser({ ...tmp.env, BROWSER_CHANNEL: 'lightpanda' });
 *     ...
 *   } finally {
 *     tmp.cleanup();
 *   }
 *
 * NOTE: cache.cacheRoot() reads process.env.XDG_CACHE_HOME directly, so
 * callers that go through the resolver must ALSO set process.env.XDG_CACHE_HOME
 * (not just pass our env object). The returned `applyToProcessEnv()`
 * helper does this idempotently and returns a restore() callback.
 *
 * @returns {{
 *   tmpBase: string,
 *   cacheDir: string,
 *   env: Record<string,string>,
 *   applyToProcessEnv: () => () => void,
 *   cleanup: () => void,
 * }}
 */
export function makeTempCache() {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ibr-e2e-lp-'));
  const cacheDir = path.join(tmpBase, 'ibr', 'browsers');
  fs.mkdirSync(cacheDir, { recursive: true });

  const env = { ...process.env, XDG_CACHE_HOME: tmpBase };

  function applyToProcessEnv() {
    const prev = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = tmpBase;
    return () => {
      if (prev === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prev;
    };
  }

  function cleanup() {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  return { tmpBase, cacheDir, env, applyToProcessEnv, cleanup };
}

/**
 * Spin up a tiny static HTTP server serving test/e2e/fixtures/static/.
 * Binds to 127.0.0.1 on an OS-assigned port (0).
 *
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = (req.url || '/').split('?')[0];
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
      // resolve relative to the fixture dir, then sanity-check that
      // the resolved path is still inside the fixture dir
      const filePath = path.normalize(path.join(FIXTURES_STATIC_DIR, urlPath));
      if (!filePath.startsWith(FIXTURES_STATIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });

    server.on('error', reject);
  });
}

/**
 * The lightpanda version these tests pin to. We deliberately do NOT pin
 * to an exact release — `stable` resolves to whatever the current stable
 * is at run time, and tests assert behavior, not version strings.
 *
 * @returns {string}
 */
export function pinnedLightpandaVersion() {
  return 'stable';
}

/**
 * Probe whether Playwright's bundled Chromium is usable. Used by the
 * fallback scenarios (test 5 + test 6) to decide whether to skip when
 * the test environment lacks `npx playwright install`.
 *
 * @returns {Promise<boolean>}
 */
export async function probeChromiumAvailable() {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}
