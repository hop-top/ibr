# 012 - Loop Safety Tests

**Persona:** [Maintainer](../personas/maintainer.md)
**Validates:** [004 - Loop / Paginated Scraping](../stories/004-loop-pagination.md)

## Goal

Automated tests confirm loop exit logic and iteration cap work correctly,
preventing infinite loops in production.

## Stories

- As a maintainer, I test that a `repeatedly:` block exits when its `if found`
  condition fails after N iterations.
- As a maintainer, I test that the 100-iteration hard cap emits a warning and
  stops without crashing.

## Acceptance Criteria

- Loop exits after condition element disappears from fixture page.
- Cap test: mock page never removes element; loop stops at 100 with warning log.
- Data accumulated across iterations is complete and correct.
- No unhandled promise rejections from loop termination.

## E2E Coverage

**Existing E2E coverage**

- [fixtures.test.js](../../test/e2e/fixtures.test.js) — partial: can execute
  loop fixtures end-to-end, but does not explicitly assert loop-cap behavior.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-loop-safety.test.js` — should
  verify natural loop exit, 100-iteration cap handling, and accumulated output.
