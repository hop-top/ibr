# 002 - Data Extraction

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Extract structured data (scalars and lists) from a page using natural language
field names.

## Stories

- As a CLI user, I write `extract: title, price, rating` to pull named fields
  from the current page into a JSON result.
- As a CLI user, I write `extract all product names` to collect a repeated
  element into a JSON array.
- As a CLI user, I receive extracted data printed to stdout on completion.

## Acceptance Criteria

- Scalar extraction returns a JSON object with requested keys.
- List extraction (`extract all …`) returns a JSON array.
- Missing fields return `null`; ibr does not throw.
- Output is valid JSON on stdout.

## E2E Coverage

**Existing E2E coverage**

- [fixtures.test.js](../../test/e2e/fixtures.test.js) — partial: validates
  extraction structurally across fixtures.
- [cli-daemon.test.js](../../test/e2e/cli-daemon.test.js) — partial: proves
  extracted values are returned to the caller on successful runs.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-extraction.test.js` — should
  verify scalar extraction, list extraction, missing-field `null` behavior, and
  the exact CLI success payload shape.
