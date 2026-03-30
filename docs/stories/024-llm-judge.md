# 024 - LLM-as-Judge for Extraction Quality

**Persona:** [Maintainer](../personas/maintainer.md)

## Summary

LLM judge scores E2E extraction results against fixture ground truth; produces
quality report + CI gate.

## Motivation

T-0015 E2E tests assert structural shape only — values flagged `needs_llm_eval`.
Non-deterministic AI output can't be exact-matched; semantic comparison required.

## Acceptance Criteria

- `npm run judge:e2e` reads `test/results/e2e/*.json`, scores each against
  `fixture.expectedExtracts`, writes quality report
- Score 0-10 per fixture; holistic rubric (not per-field)
- Missing `expectedExtracts` → skipped, no CI failure
- JSON report: `<runId>-quality.json`; markdown summary: `<runId>-summary.md`
- `--validate` mode: 3 runs, warns if variance > 0.5
- Exit 0 = mean ≥ threshold (default 7); exit 1 = below threshold
- All judge logic unit-tested with mocked AI (no real API calls)

## Implementation

- `src/judge/QualityJudge.js` — `judgeFixtureExtraction`, `makeJudgePrompt`,
  `parseJudgeResponse`
- `src/judge/ReportGenerator.js` — `generateQualityReport`,
  `computeSummaryStats`, `formatMarkdownReport`
- `src/commands/judge-e2e.js` — CLI entry point
- `test/judge/judge.test.js` — 24 unit tests

## References

- T-0014: fixture schema (`expectedExtracts` field)
- T-0015: result files at `test/results/e2e/*.json`
- `src/ai/provider.js`: `createAIProvider`, `generateAIResponse`

## E2E Coverage

**Existing E2E coverage**

- None today. Judge behavior is covered by unit tests, not the current E2E
  suite.

**Expected E2E coverage for full criteria**

- `test/e2e/judge-e2e.test.js` — should verify report
  generation, threshold gating, and `--validate` behavior against fixture
  result files.
