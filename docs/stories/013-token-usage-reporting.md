# 013 - Token Usage Reporting

**Persona:** [Integrator](../personas/integrator.md)

## Goal

Expose token usage across all AI calls so integrators can track cost and
enforce budgets.

## Stories

- As an integrator, the resolved value includes a `usage` summary with
  prompt, completion, and total token counts aggregated across all steps.
- As an integrator, I can log or forward token usage to my own observability
  system without parsing CLI output.

## Acceptance Criteria

- `usage.promptTokens`, `usage.completionTokens`, `usage.totalTokens` present
  in resolved value.
- Counts aggregated across all AI calls in the run.
- Values are integers ≥ 0.
- Available both in programmatic API and printed to stdout at CLI exit.

## E2E Coverage

**Existing E2E coverage**

- [fixtures.test.js](../../test/e2e/fixtures.test.js) — partial: records token
  counts in per-fixture result artifacts.
- [cli-daemon.test.js](../../test/e2e/cli-daemon.test.js) — partial: daemon
  success payload includes `tokenUsage`.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-token-usage.test.js` — should
  verify aggregated prompt/completion/total tokens for normal CLI success
  output and the programmatic contract once shipped.
