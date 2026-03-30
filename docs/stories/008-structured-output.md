# 008 - Structured Output

**Persona:** [Integrator](../personas/integrator.md)

## Goal

Receive extracted data as a typed, predictable JS object suitable for
downstream processing.

## Stories

- As an integrator, extracted fields map to JSON keys matching the names I
  specified in the prompt.
- As an integrator, list extractions return arrays, scalar extractions return
  strings/nulls — never mixed types.

## Acceptance Criteria

- Return value: `{ data: object|array, usage: TokenUsage }`.
- Field names in `data` match extraction field names exactly.
- Absent fields: `null`, not `undefined` or omitted.
- Type of `data` consistent with instruction (`extract all` → array,
  `extract: a,b` → object).

## E2E Coverage

**Existing E2E coverage**

- None today. The current E2E suite validates CLI behavior, not SDK return
  shapes.

**Expected E2E coverage for full criteria**

- `test/e2e/sdk-structured-output.test.js`
  — should verify object vs array outputs, key fidelity, and `null` semantics.
