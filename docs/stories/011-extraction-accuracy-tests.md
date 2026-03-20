# 011 - Extraction Accuracy Tests

**Persona:** [Maintainer](../personas/maintainer.md)
**Validates:** [002 - Data Extraction](../stories/002-data-extraction.md)

## Goal

Automated tests verify that extraction instructions produce correct,
well-typed output against known HTML fixtures.

## Stories

- As a maintainer, I run e2e tests against local HTML fixtures to confirm
  scalar and list extraction returns expected values.
- As a maintainer, I test missing-field behavior (field not in DOM returns
  null, not an error).

## Acceptance Criteria

- Tests use static HTML served locally (no live internet).
- Scalar extraction: keys match, values match expected text content.
- List extraction: array length and values match fixture.
- Missing field: `null` in output, no exception.

## Fixture Infrastructure (T-0014)

- Shared JSON fixture format at `test/fixtures/<category>/<name>.json`
- `fixture-loader.js` shared by unit, e2e, and LLM-judge test tiers
- Static validation (no browser/AI): JSON validity, schema compliance,
  instruction type rules, parsePromptString compatibility, cross-field
  consistency, category validity
- Fixture categories: instruction_types, edge_cases, parsing, extraction,
  navigation
- Tags: @fast (commit hooks), @slow (nightly only)
