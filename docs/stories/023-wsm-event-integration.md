# Story 023 — WSM Event Integration for Browser Interactions

**Status:** Done
**Task:** T-0011
**Tags:** wsm-integration, observability, artifacts

## User Story

As an agent using idx in a WSM-managed workspace, I want browser actions
recorded in the workspace timeline so I can audit, replay, and debug
web interactions alongside other workspace events.

## Acceptance Criteria

1. When WSM is absent (no binary on PATH), idx behaves identically to
   before — zero functional regression.
2. When WSM is present and a workspace is active, every browser action
   (navigate, click, fill, etc.) appears as `interaction.tool_call` in
   the workspace event log.
3. On task failure, the observability buffer (network + console logs) is
   persisted as a WSM event for auditing.
4. Annotated screenshots and failure screenshots are recorded as
   `mutation.artifact` events pointing to the file path.
5. If the WSM workspace metadata contains `browser_profile`, idx uses
   that profile for cookie import (unless `--cookies` flag overrides).
6. Before navigating to a URL, idx queries WSM for prior failure events
   at the same domain and emits a warning if failures exist.

## Implementation Notes

- `WsmAdapter` in `src/services/WsmAdapter.js`: discovery + all WSM calls.
- Discovery: `WSM_BIN` env > `~/.local/bin/wsm` > PATH scan.
- Workspace: `WSM_WORKSPACE` env > `wsm workspace config show --json`.
- All WSM calls are non-fatal: warnings logged, never thrown.
- Uses `execFile` (not `exec`) — no shell injection risk.
- Singleton `wsmAdapter` exported for Operations + index injection points.

## Files Changed

- `src/services/WsmAdapter.js` — new adapter
- `src/Operations.js` — hooks: navigate pre-flight, action record,
  artifact record, diagnostics on failure
- `src/index.js` — WSM-aware cookie injection

## Tests

- `test/unit/WsmAdapter.test.js` — 31 unit tests; 100% method coverage
