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
