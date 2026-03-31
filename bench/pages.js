/**
 * bench/pages.js — 100 public URLs for ibr benchmark
 *
 * Mix: news, docs, wiki, e-commerce-style, static, JS-heavy SPAs.
 * No auth-walled or reliably rate-limited pages.
 */

export const PAGES = [
  // --- Static / simple (fast baseline) ---
  'https://example.com',
  'https://example.org',
  'https://example.net',
  'https://httpbin.org/html',
  'https://httpbin.org/get',
  'https://neverssl.com',
  'https://info.cern.ch',
  'https://motherfuckingwebsite.com',
  'https://thebestmotherfucking.website',
  'https://justinjackson.ca/words.html',

  // --- Hacker News (SSR, light JS) ---
  'https://news.ycombinator.com',
  'https://news.ycombinator.com/newest',
  'https://news.ycombinator.com/ask',
  'https://news.ycombinator.com/show',
  'https://news.ycombinator.com/jobs',

  // --- BBC News (SSR + hydration) ---
  'https://www.bbc.com/news',
  'https://www.bbc.com/news/technology',
  'https://www.bbc.com/news/science_and_environment',
  'https://www.bbc.com/news/world',
  'https://www.bbc.com/news/business',

  // --- Reuters ---
  'https://www.reuters.com',
  'https://www.reuters.com/technology',
  'https://www.reuters.com/business',
  'https://www.reuters.com/world',
  'https://www.reuters.com/markets',

  // --- AP News ---
  'https://apnews.com',
  'https://apnews.com/hub/technology',
  'https://apnews.com/hub/science',
  'https://apnews.com/hub/business',
  'https://apnews.com/hub/world-news',

  // --- MDN Web Docs ---
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  'https://developer.mozilla.org/en-US/docs/Web/HTML',
  'https://developer.mozilla.org/en-US/docs/Web/CSS',
  'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
  'https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API',

  // --- Node.js docs ---
  'https://nodejs.org/en/docs',
  'https://nodejs.org/api/fs.html',
  'https://nodejs.org/api/http.html',
  'https://nodejs.org/api/stream.html',
  'https://nodejs.org/api/process.html',

  // --- Vitest docs ---
  'https://vitest.dev',
  'https://vitest.dev/guide',
  'https://vitest.dev/api',
  'https://vitest.dev/config',
  'https://vitest.dev/guide/mocking',

  // --- Wikipedia (encyclopedia-style, JS-moderate) ---
  'https://en.wikipedia.org/wiki/JavaScript',
  'https://en.wikipedia.org/wiki/Node.js',
  'https://en.wikipedia.org/wiki/Playwright_(software)',
  'https://en.wikipedia.org/wiki/Web_scraping',
  'https://en.wikipedia.org/wiki/Browser_automation',
  'https://en.wikipedia.org/wiki/Chromium_(web_browser)',
  'https://en.wikipedia.org/wiki/V8_(JavaScript_engine)',
  'https://en.wikipedia.org/wiki/Docker_(software)',
  'https://en.wikipedia.org/wiki/Software_benchmarking',
  'https://en.wikipedia.org/wiki/Headless_browser',

  // --- GitHub (JS-heavy SPA) ---
  'https://github.com/microsoft/playwright',
  'https://github.com/vitest-dev/vitest',
  'https://github.com/nodejs/node',
  'https://github.com/nicolo-ribaudo/tc39-proposal-temporal',
  'https://github.com/evanw/esbuild',

  // --- Playwright docs ---
  'https://playwright.dev',
  'https://playwright.dev/docs/intro',
  'https://playwright.dev/docs/api/class-page',
  'https://playwright.dev/docs/api/class-browser',
  'https://playwright.dev/docs/selectors',

  // --- ESBuild docs ---
  'https://esbuild.github.io',
  'https://esbuild.github.io/api',
  'https://esbuild.github.io/plugins',
  'https://esbuild.github.io/faq',
  'https://esbuild.github.io/getting-started',

  // --- Cloudflare blog / docs (moderate JS) ---
  'https://developers.cloudflare.com/workers',
  'https://developers.cloudflare.com/r2',
  'https://developers.cloudflare.com/d1',
  'https://blog.cloudflare.com',
  'https://developers.cloudflare.com/pages',

  // --- Web.dev (Google, moderate JS) ---
  'https://web.dev/learn',
  'https://web.dev/learn/performance',
  'https://web.dev/learn/html',
  'https://web.dev/learn/css',
  'https://web.dev/articles/vitals',

  // --- CSS-Tricks / Smashing Magazine (content-heavy) ---
  'https://css-tricks.com',
  'https://css-tricks.com/guides',
  'https://www.smashingmagazine.com',
  'https://www.smashingmagazine.com/guides',
  'https://alistapart.com',

  // --- Dev.to (SPA-ish) ---
  'https://dev.to',
  'https://dev.to/t/javascript',
  'https://dev.to/t/node',
  'https://dev.to/t/typescript',
  'https://dev.to/t/webdev',

  // --- Stack Overflow (moderate SPA) ---
  'https://stackoverflow.com/questions/tagged/javascript',
  'https://stackoverflow.com/questions/tagged/node.js',
  'https://stackoverflow.com/questions/tagged/playwright',
  'https://stackoverflow.com/questions/tagged/docker',
  'https://stackoverflow.com/questions/tagged/typescript',

  // --- npm registry pages (SSR + some hydration) ---
  'https://www.npmjs.com/package/playwright',
  'https://www.npmjs.com/package/vitest',
  'https://www.npmjs.com/package/esbuild',
  'https://www.npmjs.com/package/dotenv',
  'https://www.npmjs.com/package/better-sqlite3',
];

export default PAGES;
