# Testing lightpanda end-to-end

The `BROWSER_CHANNEL=lightpanda` happy path is covered by a **gated** e2e
suite that exercises the real browser-manager: download, spawn, Playwright
CDP connect, and the fallback / strict-refuse paths.

The suite is **off by default**. `npm test` and `npm run test:unit`
never run it, so the unit baseline stays fast and hermetic.

## Running the gated suite

```sh
BROWSER_E2E=lightpanda \
  node node_modules/vitest/vitest.mjs run \
    --config test/vitest.config.js \
    test/e2e/lightpanda.happy-path.test.js
```

The first run downloads lightpanda into a **temporary** cache dir
(`mkdtemp`-based, cleaned up at the end). The user's real
`~/.cache/ibr/browsers/` is never touched.

## Environment variables

| Variable                 | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `BROWSER_E2E=lightpanda` | **Required.** Opt-in gate. Anything else → suite is skipped.       |
| `BROWSER_VERSION`        | Optional. Pin lightpanda to a specific release (default `stable`). |
| `BROWSER_DOWNLOAD_URL`   | Optional. Override the upstream download URL for offline mirrors.  |
| `XDG_CACHE_HOME`         | Set automatically by the suite to a temp dir; do not override.     |

The suite is automatically skipped on `win32` — lightpanda is not
supported upstream there.

## What it validates

1. **Cold cache** → download + spawn + scrape a static fixture page.
2. **Warm cache** → second resolution must skip download (<15s).
3. **`BROWSER_CDP_URL`** → connect-only mode against an externally
   spawned lightpanda; no extra spawn from the resolver.
4. **Daemon repeatability** → 3 sequential `resolveBrowser()` calls
   each succeed and clean up. Reuse semantics across daemon requests
   live in `src/server.js` and are out of scope here.
5. **`BROWSER_FALLBACK=chromium`** on a deterministically broken
   lightpanda config → resolver falls back, succeeds, and records the
   failure into the capability manifest.
6. **`BROWSER_STRICT=true`** after a recorded failure → resolver
   refuses to launch with a strict-mode error.

## Prerequisites

- Node 20+
- Network access on the **first** run only (subsequent runs hit the
  warm temp cache for the duration of that test process).
- For tests 5 + 6: Playwright's bundled Chromium must be installed
  (`npx playwright install chromium`). If unavailable, the suite will
  log a notice and skip the fallback scenarios — the rest still runs.

## Troubleshooting

- **Suite is silently skipped.** Check `BROWSER_E2E=lightpanda` is
  exported in your shell, and that you are not on Windows.
- **Cold start times out.** The download budget is generous (180s for
  test 1). On very slow networks, increase by editing the per-test
  `timeout` in `test/e2e/lightpanda.happy-path.test.js`. If the
  download is the bottleneck, run the suite once with network access
  to populate `~/.cache/ibr/browsers/`, then point a future run at it
  via `XDG_CACHE_HOME`.
- **`spawn ENOENT` or lightpanda exits immediately.** The spawner
  keeps a ring buffer of recent stderr; the failure message is
  surfaced in the thrown error. Re-run with `LOG_LEVEL=debug` for
  more detail.
- **Fallback tests skipped.** Run `npx playwright install chromium`
  and re-run the suite.
- **Lightpanda children leaking after a failed run.** The `afterEach`
  hook tears handles down between scenarios, but a hard test crash
  may leave a child behind. Find and kill: `pgrep -fl lightpanda`.
