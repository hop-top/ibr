/**
 * Scenario 3 — annotate-screenshot
 *
 * Navigate, click a button, verify the JS-driven result text, then take a
 * PNG screenshot. Exercises interaction + image output path — the code
 * path behind `ibr observe` + annotated-screenshots-on-failure. Most
 * likely to expose lightpanda compat gaps (JS event loop, screenshot).
 */

import { createServer } from 'node:http';

const PAGE = `<!doctype html>
<html><head><title>annotate</title></head>
<body>
  <h1>Annotate target</h1>
  <button id="submit">Click me</button>
  <div id="result"></div>
  <script>
    document.getElementById('submit').addEventListener('click', function () {
      document.getElementById('result').textContent = 'clicked!';
    });
  </script>
</body></html>`;

let server;
let url;

export const name = 'annotate-screenshot';

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
    await page.locator('#submit').click();
    const text = await page.locator('#result').textContent();
    if ((text || '').trim() !== 'clicked!') {
      throw new Error(`annotate: click did not register (got=${text})`);
    }
    const buf = await page.screenshot({ type: 'png' });
    if (!buf || buf.length < 100) {
      throw new Error('annotate: screenshot empty or too small');
    }
  } finally {
    await page.close();
    if (ownsCtx) await ctx.close();
  }
}
