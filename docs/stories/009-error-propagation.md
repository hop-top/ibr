# 009 - Error Propagation

**Persona:** [Integrator](../personas/integrator.md)

## Goal

Surface actionable errors programmatically so pipelines can handle or
re-throw them without parsing stderr.

## Stories

- As an integrator, ibr rejects its promise with a typed error when an action
  fails, including step index and action type.
- As an integrator, configuration errors (missing API key, unknown provider)
  throw before any browser is launched.

## Acceptance Criteria

- Errors include: `{ code, message, step?, action? }`.
- Config errors throw synchronously before browser launch.
- Runtime errors (element not found, timeout) reject promise with step context.
- Non-fatal skips (`if found` on absent element) do NOT reject.

### Extended (T-0013 — high-precision messages)

- Error messages are self-contained: include what failed, why, and how to fix.
- No vague messages — every throw names the exact bad value or missing field.
