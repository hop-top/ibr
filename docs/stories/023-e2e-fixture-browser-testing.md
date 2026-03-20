# 023 - E2E Fixture Browser Testing

**Persona:** [Maintainer](../personas/maintainer.md)
**Implements:** T-0015

## Goal

Run every JSON fixture end-to-end through real Playwright + Operations
(programmatic import, not CLI spawn) to validate structural correctness of
parse + execute phases and produce result JSON for LLM-judge (T-0016).

## Stories

- As a maintainer, I run `npm run test:e2e` and every fixture is exercised
  through `parseTaskDescription()` + optional `executeTask()`.
- As a maintainer, parse results are structurally validated (URL exact,
  instruction names exact, length exact).
- As a maintainer, extract results are structurally validated when
  `expectedExtracts` is non-empty; otherwise flagged for LLM eval.
- As a maintainer, each fixture produces a result JSON file in
  `test/results/e2e/<category>__<name>.json` for T-0016 to score.
- As a maintainer, I filter to `@fast` subset via
  `npm run test:e2e:fast` for commit hooks without paying full AI cost.
- As a maintainer, edge-case fixtures that expect parse failures
  (empty instructions, missing URL) are validated as expected-error cases.

## Acceptance Criteria

- `test/e2e/fixtures.test.js` loads all fixtures via `loadAllFixtures()`.
- `test/e2e/helpers/structuralMatcher.js` exported; unit-tested.
- `test/e2e/helpers/resultRecorder.js` exported; writes to
  `test/results/e2e/`.
- `package.json` has `test:e2e` and `test:e2e:fast` scripts.
- All 10 current fixtures pass the suite (green).
- Result JSON files are written after a successful run.

## Non-Determinism Tolerance

- Instruction names: exact match required.
- Instruction count: exact match required.
- URL: exact match required (after `{SERVER_URL}` substitution).
- Extracted values: flagged `needs_llm_eval`; not asserted.
- Numbers: 10% tolerance.
