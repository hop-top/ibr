/**
 * E2E happy-path tests for BROWSER_CHANNEL=lightpanda.
 *
 * Track: adopt-lightpanda
 * Task:  T-0034
 *
 * GATED: these tests only run when BROWSER_E2E=lightpanda is set in
 * the environment. By default they are skipped so `npm test` /
 * `npm run test:unit` stay fast and hermetic.
 *
 * Run with:
 *   BROWSER_E2E=lightpanda node node_modules/vitest/vitest.mjs run \
 *     --config test/vitest.config.js \
 *     test/e2e/lightpanda.happy-path.test.js
 *
 * On the gated path these tests will:
 *   - download lightpanda via the browser-manager (cache miss)
 *   - spawn the binary, connect via Playwright CDP
 *   - drive a hermetic local static-HTTP fixture (no external network
 *     beyond the initial lightpanda download)
 *   - exercise warm cache, connect-only, fallback, and strict refusal
 *
 * See docs/testing-lightpanda.md for full instructions and
 * troubleshooting tips.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

import {
  isE2EEnabled,
  makeTempCache,
  startStaticServer,
  probeChromiumAvailable,
} from './lightpanda-helpers.js';

const E2E_ENABLED = isE2EEnabled();

if (!E2E_ENABLED) {
  // eslint-disable-next-line no-console
  console.info(
    'Lightpanda e2e tests skipped. Enable with: BROWSER_E2E=lightpanda npm run test:e2e',
  );
}

(E2E_ENABLED ? describe : describe.skip)('e2e: lightpanda happy path', () => {
  /** @type {ReturnType<typeof makeTempCache>} */
  let tmpCache;
  /** @type {Awaited<ReturnType<typeof startStaticServer>>} */
  let staticServer;
  /** @type {(() => void) | null} */
  let restoreEnv = null;
  /** @type {any} */
  let handle = null;
  /** @type {boolean} */
  let chromiumOk = false;

  beforeAll(async () => {
    tmpCache = makeTempCache();
    restoreEnv = tmpCache.applyToProcessEnv();
    staticServer = await startStaticServer();
    chromiumOk = await probeChromiumAvailable();
    if (!chromiumOk) {
      // eslint-disable-next-line no-console
      console.info(
        'Playwright bundled chromium not available — fallback scenarios (5+6) will be skipped.',
      );
    }
  }, 120_000);

  afterAll(async () => {
    if (handle) {
      try { await handle.close(); } catch { /* noop */ }
      handle = null;
    }
    if (staticServer) {
      try { await staticServer.close(); } catch { /* noop */ }
    }
    if (restoreEnv) restoreEnv();
    if (tmpCache) tmpCache.cleanup();
  });

  afterEach(async () => {
    // Best-effort: tear down any lingering handle so we never leak a
    // lightpanda child between scenarios.
    if (handle) {
      try { await handle.close(); } catch { /* noop */ }
      handle = null;
    }
  });

  it('1. fresh cache, BROWSER_CHANNEL=lightpanda → download + spawn + scrape static page', async () => {
    const { resolveBrowser } = await import('../../src/browser/index.js');
    const env = { ...tmpCache.env, BROWSER_CHANNEL: 'lightpanda' };
    handle = await resolveBrowser(env);
    expect(handle).toBeDefined();
    expect(handle.ownership).toBe('spawn-ibr');

    const page = await handle.context.newPage();
    await page.goto(staticServer.url);
    const title = await page.title();
    expect(title).toBe('ibr e2e fixture');
    const headingText = await page.locator('#heading').textContent();
    expect(headingText).toContain('Hello E2E');
  }, 180_000);

  it('2. warm cache → no new download, same result', async () => {
    const { resolveBrowser } = await import('../../src/browser/index.js');
    const env = { ...tmpCache.env, BROWSER_CHANNEL: 'lightpanda' };
    const t0 = Date.now();
    handle = await resolveBrowser(env);
    const elapsed = Date.now() - t0;
    // No download should happen — spawn + connect only. Allow generous
    // headroom for slow CI but cap well below the cold-start budget.
    expect(elapsed).toBeLessThan(15_000);
    expect(handle.ownership).toBe('spawn-ibr');
    const page = await handle.context.newPage();
    await page.goto(staticServer.url);
    expect(await page.title()).toBe('ibr e2e fixture');
  }, 30_000);

  it('3. BROWSER_CDP_URL set → connect-only, no spawn', async () => {
    // Realistic version: spin up lightpanda directly via the spawner
    // module (binary already cached from test 1), then re-resolve via
    // BROWSER_CDP_URL pointed at the running wsEndpoint. Verifies the
    // connect-only branch in the resolver dispatch.
    const { resolveBrowser } = await import('../../src/browser/index.js');
    const spawner = await import('../../src/browser/launchers/lightpanda-spawner.js');
    const cache = await import('../../src/browser/cache.js');

    // Find the cached lightpanda binary (any version present in our
    // temp cache will do — test 1 populated it).
    const channelDir = cache.channelDir('lightpanda');
    const fs = await import('node:fs');
    const versions = fs
      .readdirSync(channelDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(versions.length).toBeGreaterThan(0);
    const cached = await cache.findCached('lightpanda', versions[0]);
    expect(cached).not.toBeNull();
    const binPath = cached.executablePath;

    const spawnHandle = await spawner.spawn({ binPath, env: tmpCache.env });
    try {
      const env = {
        ...tmpCache.env,
        BROWSER_CHANNEL: 'lightpanda',
        BROWSER_CDP_URL: spawnHandle.wsEndpoint,
      };
      handle = await resolveBrowser(env);
      expect(handle.ownership).toBe('connect-user');
      const page = await handle.context.newPage();
      await page.goto(staticServer.url);
      expect(await page.title()).toBe('ibr e2e fixture');
    } finally {
      try { spawnHandle.kill(); } catch { /* noop */ }
    }
  }, 60_000);

  it('4. daemon mode → 3 sequential resolveBrowser calls succeed (spawn-connect repeatable)', async () => {
    // E2E coverage acknowledged: actual daemon "reuse" semantics live
    // in src/server.js (long-lived handle held across requests). At
    // the resolver level we can only verify that the spawn-connect
    // flow is repeatable without interference. This test runs three
    // sequential resolutions, each producing a fresh handle, and
    // tears each one down before the next.
    const { resolveBrowser } = await import('../../src/browser/index.js');
    const env = { ...tmpCache.env, BROWSER_CHANNEL: 'lightpanda' };

    for (let i = 0; i < 3; i++) {
      const h = await resolveBrowser(env);
      try {
        expect(h.ownership).toBe('spawn-ibr');
        const page = await h.context.newPage();
        await page.goto(staticServer.url);
        expect(await page.title()).toBe('ibr e2e fixture');
      } finally {
        try { await h.close(); } catch { /* noop */ }
      }
    }
  }, 120_000);

  it('5. BROWSER_FALLBACK=chromium on known-broken flow → records + succeeds', async () => {
    if (!chromiumOk) {
      // eslint-disable-next-line no-console
      console.info('Skipping test 5 — Playwright bundled chromium unavailable.');
      return;
    }
    // Force a deterministic lightpanda failure: an unreachable
    // BROWSER_CDP_URL makes step 2 select connect-only, which fails
    // immediately. With BROWSER_FALLBACK=chromium, the resolver
    // wrapper should fall back, succeed, and record the failure.
    const { resolveBrowser } = await import('../../src/browser/index.js');
    const env = {
      ...tmpCache.env,
      BROWSER_CHANNEL: 'lightpanda',
      BROWSER_CDP_URL: 'ws://127.0.0.1:1',
      BROWSER_FALLBACK: 'chromium',
    };
    handle = await resolveBrowser(env);
    expect(handle.ownership).toBe('launch');

    // Verify manifest recorded the failure under our temp cache.
    const { loadManifest } = await import('../../src/browser/capability-manifest.js');
    const m = await loadManifest(tmpCache.cacheDir);
    const keys = Object.keys(m.entries || {});
    expect(keys.length).toBeGreaterThan(0);
  }, 60_000);

  it('6. BROWSER_STRICT=true on known-broken → refuses', async () => {
    if (!chromiumOk) {
      // eslint-disable-next-line no-console
      console.info('Skipping test 6 — depends on test 5, which was skipped.');
      return;
    }
    // After test 5 populated the manifest, this should refuse.
    const { resolveBrowser } = await import('../../src/browser/index.js');
    const env = {
      ...tmpCache.env,
      BROWSER_CHANNEL: 'lightpanda',
      BROWSER_STRICT: 'true',
      BROWSER_CDP_URL: 'ws://127.0.0.1:1',
    };
    await expect(resolveBrowser(env)).rejects.toThrow(/strict|known-broken|refuse/i);
  }, 10_000);
});
