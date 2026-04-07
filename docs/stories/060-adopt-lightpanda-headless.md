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

## References

- Track: `adopt-lightpanda` (`.tlc/tracks/adopt-lightpanda/`)
- Spec: `.tlc/tracks/adopt-lightpanda/spec.md`
- Plan: `.tlc/tracks/adopt-lightpanda/plan.md`
- E2E: `docs/testing-lightpanda.md`
