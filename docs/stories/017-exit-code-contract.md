# 017 - Exit Code Contract

**Persona:** [Automated Workflow](../personas/automated-workflow.md)

## Goal

Predictable exit codes so orchestrators (cron, CI, Make) can branch on
success vs. failure without parsing output.

## Stories

- As an automated workflow, ibr exits 0 on full success and non-zero on any
  unrecovered error, enabling `&&` chaining in shell scripts.
- As an automated workflow, I can distinguish fatal errors from soft warnings
  (e.g., loop cap hit) via exit code.

## Acceptance Criteria

- Exit 0: all instructions completed, extraction returned.
- Exit 1: any unrecovered runtime error (element not found, timeout, AI error).
- Exit 2: configuration error (missing key, unknown provider).
- Loop cap reached (soft): exit 0 with warning on stderr.

## E2E Coverage

**Existing E2E coverage**

- [cli-exit-codes.test.js](../../test/e2e/cli-exit-codes.test.js) — partial:
  covers success, failure, and `snap` subcommand routing, but does not assert
  the full exact numeric exit-code matrix.

**Expected E2E coverage for full criteria**

- Extend [cli-exit-codes.test.js](../../test/e2e/cli-exit-codes.test.js) to
  assert exact `0/1/2` codes and loop-cap soft-warning behavior.
