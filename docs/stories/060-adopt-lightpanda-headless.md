# 060 - Adopt Lightpanda for Fast Headless Scraping

## Goal

Use [lightpanda](https://github.com/lightpanda-io/browser) — a Zig-built
headless browser with ~9× faster startup and ~16× less memory than Chromium —
as an opt-in ibr backend so CI pipelines and agent loops complete faster and
consume less shared runner capacity.

## Stories

- As a developer running many short-lived scrape/extract jobs, I invoke
  `BROWSER_CHANNEL=lightpanda ibr "<prompt>"` and it works with zero manual
  install steps; ibr auto-downloads the stable release on first run.
- As a CI operator, I pre-warm the browser cache with
  `ibr browser pull lightpanda stable` so first-run latency does not hit
  the critical path.
- As an agent author dealing with lightpanda compat gaps, I set
  `BROWSER_FALLBACK=chromium` so failing scenarios silently retry on
  chromium and are recorded for future pre-flight warnings.
- As a long-running server operator, ibr's daemon mode reuses a single
  lightpanda child across many invocations (daemon-owned lifecycle).
- As a connect-only integrator, I run my own CDP server and point ibr at
  it via `BROWSER_CDP_URL=ws://127.0.0.1:9222` — ibr skips acquisition
  and spawn entirely.

## Acceptance Criteria

- `BROWSER_CHANNEL=lightpanda ibr "<prompt>"` works end-to-end with no
  manual install steps (auto-downloads on first run; cache under
  `~/.cache/ibr/browsers/lightpanda/`).
- Opt-in fallback available via `BROWSER_FALLBACK=chromium`; fallback usage
  recorded in the capability manifest for future pre-flight warnings.
- Three lifecycle modes supported: connect-only (`BROWSER_CDP_URL`),
  daemon-owned (long-running `IBR_DAEMON=true` server), one-shot (default CLI).
- `ibr browser list`, `ibr browser pull`, `ibr browser prune`,
  `ibr browser which` commands available for cache management + debugging.
- `BROWSER_STRICT=true` refuses launch when capability manifest has known-broken
  entries for current version.
- `LIGHTPANDA_WS` still works as deprecated alias for `BROWSER_CDP_URL`; emits
  warning on use.
- Gated e2e suite validates full stack under `BROWSER_E2E=lightpanda`
  (see `docs/testing-lightpanda.md`).
- Lightpanda telemetry disabled by default; opt-in via `LIGHTPANDA_TELEMETRY=true`.

## Out of Scope

- Full Playwright API parity on lightpanda (minimum op set only).
- Windows support (lightpanda unsupported upstream).
- Bundled redistribution of Chrome / Brave / Arc / Comet binaries.

## E2E Coverage

> **Gated / opt-in.** The suite below is **not** part of the default run.
> `npm test`, `npm run test:unit`, and `npm run test:e2e` all skip it unless
> `BROWSER_E2E=lightpanda` is exported (and the host is not Windows). See
> [testing-lightpanda.md](../testing-lightpanda.md) for the invocation and
> prerequisites. A reader should treat this coverage as validated only when the
> gate is set and a lightpanda binary is reachable.

**Existing E2E coverage** — [lightpanda.happy-path.test.js](../../test/e2e/lightpanda.happy-path.test.js)
(gated on `BROWSER_E2E=lightpanda`):

- Test 1 (fresh cache) — proves cold-cache auto-download + spawn + scrape a
  static page with `BROWSER_CHANNEL=lightpanda` and `ownership === 'spawn-ibr'`
  (criterion: works end-to-end, no manual install).
- Test 2 (warm cache) — proves the second resolution skips download (< 15s),
  same result (cache pre-warm / `ibr browser pull` payoff).
- Test 3 (`BROWSER_CDP_URL`) — proves connect-only mode against an externally
  spawned lightpanda with `ownership === 'connect-user'`, no extra spawn
  (criterion: connect-only lifecycle mode).
- Test 4 (daemon repeatability) — proves 3 sequential `resolveBrowser()` calls
  each spawn, scrape, and tear down cleanly (partial: resolver-level
  repeatability; true daemon handle-reuse lives in `src/server.js`).
- Test 5 (`BROWSER_FALLBACK=chromium`) — proves a deterministically broken
  lightpanda config falls back to chromium (`ownership === 'launch'`) **and**
  records the failure into the capability manifest (criteria: opt-in fallback +
  manifest recording). Skipped when bundled chromium is unavailable.
- Test 6 (`BROWSER_STRICT=true`) — proves the resolver refuses to launch after
  a recorded known-broken entry (criterion: strict refusal). Depends on test 5.

**Expected E2E coverage for full criteria** (not yet asserted by the gated suite):

- `ibr browser list | pull | prune | which` cache-management CLI commands —
  exercised only indirectly (cache is manipulated through `resolveBrowser`);
  no test drives the subcommands themselves.
- `LIGHTPANDA_WS` deprecated-alias warning for `BROWSER_CDP_URL`.
- `LIGHTPANDA_TELEMETRY` default-off / opt-in behavior.
- These are unit-side or CLI-surface concerns; add targeted coverage rather
  than expanding the network-dependent gated suite.

## References

- Track: `adopt-lightpanda` (`.tlc/tracks/adopt-lightpanda/`)
- Spec: `.tlc/tracks/adopt-lightpanda/spec.md`
- Plan: `.tlc/tracks/adopt-lightpanda/plan.md`
- E2E: `docs/testing-lightpanda.md`
