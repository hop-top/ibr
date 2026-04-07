# Changelog

All notable changes to `ibr` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) / [Conventional Commits](https://www.conventionalcommits.org/).

---

## [Unreleased]

### Added

- **Browser-manager subsystem** (track: adopt-lightpanda). New `src/browser/`
  module replaces the narrow `src/utils/browserChannel.js` with a resolution
  chain, managed cache, and lifecycle dispatch.
- **Lightpanda support** via `BROWSER_CHANNEL=lightpanda` (aliases `panda`,
  `lp`). Auto-downloads stable/nightly releases from GitHub; spawns the child
  process and connects via Playwright CDP. Three lifecycle modes: connect-only
  (`BROWSER_CDP_URL`), daemon-owned, one-shot.
- **`ibr browser` CLI subcommand group**: `list`, `pull`, `prune`, `which`
  for cache management and resolver debugging.
- **Self-healing capability manifest**: records known-broken lightpanda flows
  when `BROWSER_FALLBACK` succeeds; `BROWSER_STRICT=true` refuses pre-launch
  if entries exist for the current version.
- **Gated e2e suite**: `BROWSER_E2E=lightpanda` enables 6 happy-path scenarios.
  See `docs/testing-lightpanda.md`.
- New env vars: `BROWSER_CDP_URL`, `BROWSER_VERSION`, `BROWSER_DOWNLOAD_URL`,
  `BROWSER_FALLBACK`, `BROWSER_STRICT`, `BROWSER_REQUIRE_CHECKSUM`,
  `LIGHTPANDA_TELEMETRY`.

### Changed

- `src/utils/browserChannel.js` is now a thin shim delegating to the new
  resolver. Public API unchanged.
- `src/server.js`, `src/index.js`, `src/commands/snap.js` direct
  `chromium.launch()` call sites migrated to `resolveBrowser(env)`.

### Deprecated

- `LIGHTPANDA_WS` env var — use `BROWSER_CDP_URL` instead. Emits a warning
  on use.

### feat

- **`ibr tool` subcommand — YAML-defined browser tools (T-0002)**
  - `src/commands/tool.js` — YAML loader, param interpolator, prompt builder.
  - `tools/web-search.yaml` — search engine results tool (T-0003).
  - `tools/web-fetch.yaml` — direct URL fetch + content extraction tool (T-0004).
  - `ibr tool <name> [--param k=v ...]` — load tool, interpolate, run via std path.
  - `ibr tool --list` — list available tools; no browser/AI key required.
  - Missing required param → non-zero exit with clear error.
  - Unknown tool → non-zero exit with "Tool not found" message.
  - Story: `docs/stories/040-tool-subcommand.md`.

### test

- **Tier 3 LLM-as-judge for extraction quality (T-0016)**
  - `src/judge/QualityJudge.js` — holistic 0-10 scoring via LLM judge.
  - `src/judge/ReportGenerator.js` — quality report + markdown summary generation.
  - `src/commands/judge-e2e.js` — `npm run judge:e2e` CLI; exits 1 if mean < threshold.
  - `test/judge/judge.test.js` — 24 unit tests (all AI mocked).
  - `--validate` mode: 3-run variance check. `--threshold` configurable (default 7).
  - Story: `docs/stories/024-llm-judge.md`.

- **Tier 2 E2E AI-agent fixture testing (T-0015)**
  - `test/e2e/fixtures.test.js` — runs all fixtures through real Playwright + real AI.
  - `test/e2e/helpers/structuralMatcher.js` — shape comparison with 10% number tolerance.
  - `test/e2e/helpers/resultRecorder.js` — per-fixture result JSON writer.
  - `test/unit/e2e/structuralMatcher.test.js`, `resultRecorder.test.js` — 24 unit tests.
  - `package.json`: `test:e2e` (all) + `test:e2e:fast` (@fast subset) scripts.
  - Result files in `test/results/e2e/<category>-<name>.json` for T-0016 LLM judge.
  - Story: `docs/stories/023-e2e-fixture-testing.md`.

### refactor

- **Removed dead `validateAIResponse` function (T-0027)**
  - `src/utils/validation.js` — deleted unused function; no callers existed.
  - `test/unit/utils/validation.test.js` — removed corresponding dead tests.
  - No user-facing behaviour change.

### feat

- **High-precision AI-actionable error messages (T-0013)**
  - 29 error strings rewritten across 8 source files; no logic changes.
  - Every error is self-contained: what failed + why + concrete next step.
  - Element resolution failures include `ibr snap <url> -i` and `@refs` hint.
  - Action failures include `hidden, disabled, or covered` diagnosis hint.
  - AI parse failures suggest `AI_TEMPERATURE=0` and prompt format corrections.
  - Config/flag errors include bad value, accepted range/set, Usage, Example.
  - Story: `docs/stories/021-high-precision-errors.md`.
  - Tests: unit coverage added for all new error paths in
    `snap.parse.test.js`, `index.flags.test.js`,
    `Operations.instructions.test.js`, `ai/provider.test.js`.
  - E2E: `test/e2e/cli-errors.test.js` validates high-precision output for
    missing prompt, missing snap URL, bad `AI_TEMPERATURE`, malformed AI JSON,
    missing `--cookies` value.

- **Annotated screenshots for visual debugging (T-0009)**
  - `--annotate` / `-a` CLI flag: captures full-page PNG after each element-resolution
    step; overlays show red bounding boxes labeled `@e1`/`@c1` etc.
  - Output path: `/tmp/ibr-annotate-step-<N>-<ts>.png`.
  - `ANNOTATED_SCREENSHOTS_ON_FAILURE=true` env var: auto-captures on any
    action failure; path `/tmp/ibr-failure-step-<N>-<ts>.png`; non-fatal.
  - `src/services/AnnotationService.js` — pure DOM overlay injection via
    `page.evaluate`; no image-library dep. Path validation (must be `/tmp` or
    `cwd`). Bbox fetched in parallel batches ≤50. Cleanup always runs (finally).
  - CSP errors caught + logged as warnings; execution continues without screenshot.
  - Off-screen / hidden elements (null bbox) silently skipped.
  - Story: `docs/stories/021-visual-debugging.md`; ACs also added to
    `docs/stories/006-debug-observability.md`.

- **Daemon mode — persistent browser for fast warm invocations (T-0012)**
  - Opt-in: `IBR_DAEMON=true` or `--daemon` flag; stateless flow unchanged by default.
  - `src/server.js` — Node.js HTTP daemon: Chromium + Operations stay alive 30 min;
    random port, localhost-only, UUID Bearer token, atomic state file `~/.ibr/server.json`.
  - `src/daemon.js` — CLI client: `ensureServer()` + `sendCommand()`; auto-restarts on
    stale PID or failed health check; retries once on `ECONNREFUSED`.
  - `GET /health` (no auth) → `{status, uptime, pid}`.
  - `POST /command` (Bearer required) → plain-text result or JSON error with hint.
  - Latency: ~540 ms warm vs ~3800 ms cold.
  - `npm run server` — start daemon manually.

### Changed

- **Page representation: quality-based aria/dom auto-selection (T-0005 rev)**
  - `Operations.#getPageContext()` captures an ARIA snapshot then scores its
    quality before committing to a mode; no longer a simple size-only threshold.
  - Quality check (`assessQuality`) counts unnamed interactive elements
    (`- button ""`, `- link ""`) and computes a sparsity ratio. If more than
    40% of interactive elements are unnamed, the snapshot is too sparse for
    reliable AI targeting → falls back to `DomSimplifier`.
  - Full fallback criteria (auto mode):
    - `sparsityRatio > 0.4` → dom (`sparse (N.NN)`)
    - snapshot > 50 000 chars → dom (`size`)
    - snapshot empty / null → dom (`empty`)
    - otherwise → aria
  - Logged output: `'using aria mode'` / `'falling back to dom mode: <reason>'`.

- **`--mode aria|dom|auto` CLI flag**
  - Users can override auto-selection per invocation.
  - `--mode aria` — always use ariaSnapshot (skip quality check).
  - `--mode dom` — always use DomSimplifier (canvas apps, legacy table-soup).
  - `--mode auto` — default; quality-based selection described above.
  - Invalid value exits with error message listing valid options.

- **`src/utils/ariaSimplifier.js`** updated with:
  - `assessQuality(snapshot)` — returns `{ sparsityRatio, tooLarge, empty }`.
  - `selectMode(snapshot, forcedMode)` — encapsulates all selection logic;
    returns `{ mode, reason }`.
  - Exported constants `SIZE_THRESHOLD` (50 000) and `SPARSITY_THRESHOLD` (0.4).

- **Element descriptor format** (unchanged from T-0005 base)
  - ARIA path: AI returns `{role, name}`; resolved via `getByRole` → `getByLabel`
    → `getByText` → `getByPlaceholder`.
  - DOM path: AI returns `{x: index}`; resolved via XPath table in `DomSimplifier`.

### feat

- **`ibr snap` subcommand** — on-demand DOM inspection without writing a full task.
  - `ibr snap <url>` — outputs simplified DOM JSON to stdout (`=== DOM Tree ===`)
  - `ibr snap --aria <url>` — outputs Playwright `ariaSnapshot()` YAML (`=== ARIA Snapshot ===`)
  - `ibr snap --aria -i <url>` — ARIA snapshot filtered to interactive elements
    (role + non-empty name)
  - `-i` — interactive only: dom → xpath-indexed nodes; aria → role+name lines
  - `-a` — annotated screenshot with orange outlines → `/tmp/ibr-dom-annotated.png` (dom only)
  - `-d <N>` — depth limit; truncate tree at level N (dom only)
  - `-s <selector>` — scope tree to a CSS selector subtree (dom only)
  - `-a`, `-d`, `-s` are DOM-only; not compatible with `--aria`
  - Flags are composable; e.g. `ibr snap <url> -i -s "nav" -d 3 -a`

- **Snapshot diffing** — automatic ~85% token reduction in loop workflows.
  - `SnapshotDiffer` works in both dom and aria modes
  - dom mode: tracks up to 5 snapshots keyed by XPath; sends added/removed/modified nodes
  - aria mode: line-based set diff of `ariaSnapshot()` YAML; keyed by role+name
  - Falls back to full snapshot on navigation, >50% node/line churn, 5-min staleness,
    or mode mismatch between stored and current snapshot
  - No user configuration required

### refactor

- **`SnapshotDiffer` — mode-aware diffing** — extended from DOM-only to support aria mode.
  - `captureSnapshot(snap, xpaths, mode)` — accepts `'dom'` or `'aria'` mode parameter
  - `computeDiff(curr, currXpaths)` — branches on stored mode; aria uses line-set diff
  - Mode mismatch (stored dom vs current aria or vice versa) forces full snapshot
  - Replaces single-mode DOM-only implementation with unified mode-aware design

- **`DomSimplifier` options** — new `{ selector, maxDepth }` constructor options used
  by the `dom` subcommand.

### Internal

- `Operations.#getPageContext()` passes `this.mode` (from CLI flag) to
  `selectMode`; returns `{ context, domTree, isAria }`.
- `Operations` constructor accepts `options.mode`; defaults to `'auto'`.
- `index.js` parses `--mode` flag via `parseCliFlags()`; validates against
  `VALID_MODES = new Set(['aria', 'dom', 'auto'])`.

### Impact on users

Prompt language unchanged — describe elements in plain English as always.
Auto mode behaves conservatively: only uses ARIA when the snapshot is high
quality. Sites that previously returned sparse ARIA trees now get DOM mode
automatically. Use `--mode aria` to force ARIA if you prefer to override.

---

## Earlier history

Pre-CHANGELOG. See `git log` for full commit history.
