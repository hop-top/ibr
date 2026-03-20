# Changelog

All notable changes to `idx` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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
