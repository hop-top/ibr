# 036 - Prior-Failure Preflight Warnings

**Persona:** [Workspace Operator](../personas/workspace-operator.md)

## Goal

Warn before running against a domain with prior recorded failures so retries
start with more context and caution.

## Stories

- As a workspace operator, I get a warning when the workspace already contains
  failures for the same target domain.
- As a workspace operator, the warning is advisory only and never blocks the
  task.

## Acceptance Criteria

- Before navigating, ibr queries WSM for prior failure events on the same
  domain.
- When failures exist, ibr logs a warning that includes the count.
- When there are no matching failures, no warning is emitted.
- When WSM is unavailable or the query fails, execution continues silently.

## E2E Coverage

**Existing E2E coverage**

- None today. Current WSM E2E tests do not exercise historical preflight
  warnings.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-wsm-preflight.test.js` —
  should verify warning emission on same-domain history and non-blocking
  behavior when WSM is absent or failing.
