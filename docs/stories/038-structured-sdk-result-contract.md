# 038 - Structured SDK Result Contract

**Persona:** [Integrator](../personas/integrator.md)

## Goal

Define a stable SDK result shape so downstream integrations can rely on fields,
null semantics, and error payloads without reverse-engineering runtime objects.

## Stories

- As an integrator, successful SDK calls resolve to a predictable object shape.
- As an integrator, failed SDK calls reject with a predictable error shape.

## Acceptance Criteria

- Successful SDK calls resolve to an object containing extracted data and token
  usage.
- Scalar and list results preserve the same shape guarantees described by the
  structured-output stories.
- Missing extracted fields resolve to `null`, not omitted keys.
- Failed SDK calls reject with structured errors containing `code`, `message`,
  and any relevant step/action metadata.

## E2E Coverage

**Existing E2E coverage**

- None today.

**Expected E2E coverage for full criteria**

- `test/e2e/sdk-result-contract.test.js` —
  should verify resolved result schema, `null` semantics, and rejected error
  schema for SDK consumers.
