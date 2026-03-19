# 018 - Execution Timeout

**Persona:** [Automated Workflow](../personas/automated-workflow.md)

## Goal

Global wall-clock timeout prevents runaway idx processes from blocking
scheduled pipelines indefinitely.

## Stories

- As an automated workflow, I set `EXECUTION_TIMEOUT_MS` to cap total run
  time; idx exits with a timeout error if exceeded.
- As an automated workflow, per-action timeouts (`BROWSER_TIMEOUT`) are
  distinct from the global timeout.

## Acceptance Criteria

- `EXECUTION_TIMEOUT_MS` env var sets a global cap on total execution time.
- When global timeout fires: browser closed, exit code 1, JSON error on stderr
  with `code: TIMEOUT`.
- `BROWSER_TIMEOUT` controls per-page-load/element-wait timeout independently.
- Default global timeout: none (unbounded) unless env var set.
