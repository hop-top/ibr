# 039 - Clean Help Output

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

`ibr --help` prints plain, human-readable text — no timestamps, no log-level
prefixes — while still routing to stderr so stdout stays clean for pipelines.

## Stories

- As a CLI user, running `ibr --help` shows plain text with no timestamp or
  level prefix cluttering the output.
- As an AI coding assistant, help output goes to stderr so stdout remains
  reserved for extracted data.

## Acceptance Criteria

- `ibr --help` output contains no timestamp pattern (`YYYY-MM-DD HH:mm:ss`).
- `ibr --help` output contains no log-level prefix (`info:`, `warn:`, etc.).
- Help text is written to stderr (exit 0; stdout empty).
- All other log output (runtime, errors, debug) continues to use the winston
  logger with full formatting.

## E2E Coverage

**Expected E2E coverage**

- `test/e2e/cli-help.test.js` — verify stdout empty, stderr contains usage
  text, no timestamp/level prefix present.
