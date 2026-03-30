# 027 - Inspect Before Automating

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Inspect a page quickly before authoring or retrying a task so element targeting
can be grounded in the same representation ibr uses at runtime.

## Stories

- As a user, I run `ibr snap <url>` to inspect a page without writing a full
  task prompt.
- As a user, I inspect either DOM mode or ARIA mode depending on the kind of
  page I am debugging.
- As an AI coding assistant, I use `ibr snap` to gather page context before I
  rewrite a failing prompt.

## Acceptance Criteria

- `ibr snap <url>` runs without requiring AI provider configuration.
- Default output is the DOM representation headed by `=== DOM Tree ===`.
- `ibr snap --aria <url>` outputs the ARIA representation headed by
  `=== ARIA Snapshot ===`.
- `ibr snap -i` narrows output to interactive elements only.
- `ibr snap -a` writes an annotated screenshot and prints the path to stderr.

## E2E Coverage

**Existing E2E coverage**

- [cli-exit-codes.test.js](../../test/e2e/cli-exit-codes.test.js) — partial:
  verifies that `ibr snap` bypasses AI setup and emits the DOM tree header.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-snap.test.js` — should verify DOM and
  ARIA output, interactive filtering, and screenshot generation.
