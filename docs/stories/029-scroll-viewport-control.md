# 029 - Scroll / Viewport Control

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Reveal content outside the initial viewport so lazy-loaded or off-screen
content can be acted on or extracted reliably.

## Stories

- As a CLI user, I instruct ibr to scroll before interacting with content that
  is initially off-screen.
- As a CLI user, I combine scrolling with extraction or loops when a page loads
  more content progressively.

## Acceptance Criteria

- Task parsing accepts explicit scroll instructions.
- Runtime execution performs the requested scroll without requiring selectors.
- Scroll instructions can appear before actions or inside repeated flows.
- Scroll failures produce actionable runtime errors rather than hanging.

## E2E Coverage

**Existing E2E coverage**

- None today.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-scroll.test.js` — should verify
  explicit scroll execution, scroll-plus-extract workflows, and scroll usage in
  repeated flows.
