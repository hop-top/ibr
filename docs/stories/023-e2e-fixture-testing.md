# 023 - Tier 2: E2E AI-Agent Fixture Testing (T-0015)

**Persona:** [Maintainer](../personas/maintainer.md)

## Goal

Run ibr tasks end-to-end (real browser + real AI provider) against shared fixtures.
Produce per-fixture result JSON for T-0016 LLM judge to score.

## User Value

Validates that the full ibr pipeline (parse → navigate → execute) produces
structurally correct outputs against a curated fixture suite, using real
AI without mocking.

## Behaviour

- `npm run test:e2e` — runs all fixtures (real AI calls; ~$0.01–0.10 per fixture)
- `npm run test:e2e:fast` — runs `@fast`-tagged fixtures only (commit-hook safe)
- Per-fixture result file written to `test/results/e2e/<category>-<name>.json`
- Structural match asserted (not value-exact); value diffs flagged for T-0016

## Acceptance Criteria

- `npm run test:e2e` executes the loaded fixture suite end-to-end.
- `E2E_TAGS` filtering limits execution to matching tagged fixtures.
- Each fixture writes a result artifact under `test/results/e2e/`.
- Structural parse/extract mismatches fail the run; value-only diffs are
  recorded for downstream judgment.

## Structural Match Rules

- URL: exact match
- instructions[]: same length + same names (exact); nested recursed
- extracted fields: keys + types match; values deferred to T-0016
- numbers: 10% tolerance
- Structural failures = test failures; value diffs = recorded in result JSON

## Result File Schema

```
test/results/e2e/<category>-<name>.json
{
  fixtureFile, fixtureCategory, prompt,
  execution: { status, duration_ms, timestamp },
  parsed: { expected, actual, matches, match_details, parse_error },
  extracts: { expected, actual, matches, match_type, structural_notes, extract_error },
  tokens: { prompt, completion, total },
  ai_provider: { provider, model, temperature },
  tags, notes
}
```

## Tag Convention

- `@fast` — quick fixtures for commit hooks
- `@slow` — expensive; nightly CI only
- `@extraction` — extraction-heavy fixtures

## New Files

- `test/e2e/fixtures.test.js` — main test file
- `test/e2e/helpers/structuralMatcher.js` — shape comparison + match_details
- `test/e2e/helpers/resultRecorder.js` — result JSON writer
- `test/unit/e2e/structuralMatcher.test.js` — unit tests
- `test/unit/e2e/resultRecorder.test.js` — unit tests

## Refs

- T-0014: fixture loader (`test/unit/fixtures/fixture-loader.js`)
- T-0016: LLM judge consuming `test/results/e2e/*.json`

## E2E Coverage

**Existing E2E coverage**

- [fixtures.test.js](../../test/e2e/fixtures.test.js) — full: this story is
  implemented directly by the current E2E fixture runner.

**Expected E2E coverage for full criteria**

- None beyond current coverage.
