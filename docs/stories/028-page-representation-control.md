# 028 - Page Representation Control

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Override automatic page representation selection when a target site works
better with ARIA, DOM, or heuristic auto-selection.

## Stories

- As a CLI user, I force `--mode aria` when the accessibility tree is the best
  representation for the page.
- As a CLI user, I force `--mode dom` when the ARIA tree is sparse or
  misleading.
- As a CLI user, I keep `--mode auto` when I want ibr to choose per page.

## Acceptance Criteria

- `--mode aria` forces ARIA mode when an ARIA snapshot is available.
- `--mode dom` forces DOM simplification mode.
- `--mode auto` uses runtime heuristics to select the representation.
- Invalid `--mode` values exit non-zero with a descriptive usage error.
- Logs identify the chosen mode and the reason when auto-selection is used.

## E2E Coverage

**Existing E2E coverage**

- [cli-annotate.test.js](../../test/e2e/cli-annotate.test.js) — partial: uses
  `--mode dom` successfully, but does not assert mode behavior explicitly.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-mode-selection.test.js` —
  should verify forced DOM mode, forced ARIA mode, auto-selection, and invalid
  flag handling.
