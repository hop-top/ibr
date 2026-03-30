# 010 - Instruction Parsing Tests

**Persona:** [Maintainer](../personas/maintainer.md)
**Validates:** [001 - Basic Navigation & Action](../stories/001-basic-nav-action.md)

## Goal

Automated tests confirm that ibr correctly parses all instruction types from
natural language prompts into structured action plans.

## Stories

- As a maintainer, I run unit tests against the BAML/AI parser to verify
  click/fill/type/press instructions produce correct JSON action plans.
- As a maintainer, I assert edge cases: empty instructions, unknown verbs,
  deeply nested blocks.

## Acceptance Criteria

- All instruction types (click, fill, type, press, extract, repeatedly,
  if found) parsed correctly in unit tests.
- Malformed prompts produce parse errors with descriptive messages.
- Tests run without a real browser or AI API call (mocked AI responses).

## E2E Coverage

**Existing E2E coverage**

- [fixtures.test.js](../../test/e2e/fixtures.test.js) — partial: structurally
  validates parsed task descriptions against fixture expectations.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-parse-instruction-matrix.test.js`
  — should cover the full prompt-to-plan matrix with dedicated end-to-end parse
  assertions for each instruction type.
