# Changelog

All notable changes to `idx` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) / [Conventional Commits](https://www.conventionalcommits.org/).

---

## [Unreleased]

### feat

- **Daemon mode — persistent browser for fast warm invocations (T-0012)**
  - Opt-in: `IDX_DAEMON=true` or `--daemon` flag; stateless flow unchanged by default.
  - `src/server.js` — Node.js HTTP daemon: Chromium + Operations stay alive 30 min;
    random port, localhost-only, UUID Bearer token, atomic state file `~/.idx/server.json`.
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

- **`idx snap` subcommand** — on-demand DOM inspection without writing a full task.
  - `idx snap <url>` — outputs simplified DOM JSON to stdout (`=== DOM Tree ===`)
  - `idx snap --aria <url>` — outputs Playwright `ariaSnapshot()` YAML (`=== ARIA Snapshot ===`)
  - `idx snap --aria -i <url>` — ARIA snapshot filtered to interactive elements
    (role + non-empty name)
  - `-i` — interactive only: dom → xpath-indexed nodes; aria → role+name lines
  - `-a` — annotated screenshot with orange outlines → `/tmp/idx-dom-annotated.png` (dom only)
  - `-d <N>` — depth limit; truncate tree at level N (dom only)
  - `-s <selector>` — scope tree to a CSS selector subtree (dom only)
  - `-a`, `-d`, `-s` are DOM-only; not compatible with `--aria`
  - Flags are composable; e.g. `idx snap <url> -i -s "nav" -d 3 -a`

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
