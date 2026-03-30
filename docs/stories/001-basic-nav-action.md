# 001 - Basic Navigation & Action

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Navigate to a URL and perform click/fill/type/press actions described in
natural language.

## Stories

- As a CLI user, I pass a `url` + `instructions` block so ibr opens the page
  and executes each action in order.
- As a CLI user, I describe elements by visible text or role so ibr locates
  them without selectors.
- As a CLI user, I use `press KeyName` to trigger keyboard events (Enter,
  Escape, Tab, etc.).

## Acceptance Criteria

- `ibr` accepts YAML-like prompt string as CLI argument.
- Navigates to `url` before executing instructions.
- Executes `click`, `fill`, `type`, `press` in sequence.
- Times out gracefully with an actionable error if element not found.

## E2E Coverage

**Existing E2E coverage**

- [fixtures.test.js](../../test/e2e/fixtures.test.js) — partial: exercises the
  parse-and-execute flow end-to-end, but does not provide a dedicated action
  matrix for `click`, `fill`, `type`, and `press`.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-actions.test.js` — should verify the
  `click`, `fill`, `type`, and `press` instruction paths plus element-not-found
  failure behavior.
