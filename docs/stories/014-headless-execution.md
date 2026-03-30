# 014 - Headless Execution

**Persona:** [AI Coding Assistant](../personas/ai-coding-assistant.md),
[Automated Workflow](../personas/automated-workflow.md)

## Goal

Run ibr without a display server or interactive window; suitable for
CI environments, Docker containers, and agent subprocesses.

## Stories

- As an AI coding assistant, I invoke ibr with `BROWSER_HEADLESS=true` (or
  default) so it runs silently without opening a visible window.
- As an automated workflow, ibr works inside a headless Linux container with
  no `DISPLAY` env var set.

## Acceptance Criteria

- `BROWSER_HEADLESS=true` (default) launches Chromium in headless mode.
- No Xvfb or display server required when headless.
- Exit code 0 on success, non-zero on any unrecovered error.

## E2E Coverage

**Existing E2E coverage**

- [cli-headless.test.js](../../test/e2e/cli-headless.test.js) — partial:
  covers successful headless runs and absence of display-related errors.

**Expected E2E coverage for full criteria**

- Extend [cli-headless.test.js](../../test/e2e/cli-headless.test.js) to verify
  the default headless path and explicit execution with no `DISPLAY` available.
