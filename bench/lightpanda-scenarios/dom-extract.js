/**
 * Scenario 2 — dom-extract
 *
 * Simulates `ibr snap`-like behaviour: navigate to a richer page, take an
 * aria snapshot, and extract the full body innerText. Exercises the DOM
 * serialization + text extraction path that snap + observe rely on.
 */

import { createServer } from 'node:http';

const PAGE = `<!doctype html>
<html><head><title>dom-extract</title></head>
<body>
  <header>
    <nav><ul><li>home</li><li>about</li><li>contact</li></ul></nav>
  </header>
  <main>
    <article>
      <h1>Primary heading</h1>
      <section>
        <h2>Section A</h2>
        <p>Paragraph one with <a href="#">a link</a>.</p>
        <ul><li>alpha</li><li>beta</li><li>gamma</li></ul>
      </section>
      <section>
        <h2>Section B</h2>
        <p>Paragraph two.</p>
        <table><tbody>
          <tr><td>r1c1</td><td>r1c2</td></tr>
          <tr><td>r2c1</td><td>r2c2</td></tr>
        </tbody></table>
      </section>
    </article>
  </main>
  <footer><small>footer text</small></footer>
</body></html>`;

let server;
let url;

export const name = 'dom-extract';

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

    // aria snapshot — may fail on lightpanda if accessibility tree is
    // not implemented; caller catches + records error.
    const aria = await page.locator('body').ariaSnapshot();

    // full innerText via evaluate — tests JS bridge
    const text = await page.evaluate(() => document.body.innerText);

    if (!aria || typeof aria !== 'string' || aria.length === 0) {
      throw new Error('dom-extract: empty aria snapshot');
    }
    if (!text || !text.includes('Primary heading')) {
      throw new Error('dom-extract: innerText missing expected content');
    }
  } finally {
    await page.close();
    if (ownsCtx) await ctx.close();
  }
}
