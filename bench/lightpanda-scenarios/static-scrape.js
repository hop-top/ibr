/**
 * Scenario 1 — static-scrape
 *
 * Navigate, extract title + element text + count paragraphs.
 * Measures the cheapest possible end-to-end path: nav + simple DOM reads.
 *
 * Setup/teardown create a local HTTP server so we don't hit the public
 * internet and don't depend on disk.
 */

import { createServer } from 'node:http';

const PAGE = `<!doctype html>
<html><head><title>bench</title></head>
<body>
  <h1 id="t">Bench Target</h1>
  <p>one</p>
  <p>two</p>
  <p>three</p>
</body></html>`;

let server;
let url;

export const name = 'static-scrape';

export async function setup() {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
}

export async function teardown() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
}

/**
 * @param {{ browser: import('playwright').Browser, context: ?import('playwright').BrowserContext }} handle
 */
export async function run(handle) {
  const ctx = handle.context || (await handle.browser.newContext());
  const ownsCtx = !handle.context;
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    const h1 = await page.locator('#t').textContent();
    const pCount = await page.locator('p').count();
    if (title !== 'bench' || (h1 && h1.trim() !== 'Bench Target') || pCount !== 3) {
      throw new Error(
        `static-scrape: unexpected content (title=${title}, h1=${h1}, p=${pCount})`
      );
    }
  } finally {
    await page.close();
    if (ownsCtx) await ctx.close();
  }
}
