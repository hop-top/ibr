# Maintainer

## Description

Developer writing and running automated tests for the ibr project to ensure
correctness across changes. Cares about test coverage, regression prevention,
DOM simplification fidelity, and AI prompt stability.

## Stories

- [010 - Instruction Parsing Tests](../stories/010-instruction-parsing-tests.md)
- [011 - Extraction Accuracy Tests](../stories/011-extraction-accuracy-tests.md)
- [012 - Loop Safety Tests](../stories/012-loop-safety-tests.md)
- [023 - E2E Fixture Testing](../stories/023-e2e-fixture-testing.md)
- [024 - LLM-as-Judge](../stories/024-llm-judge.md)

## Related Stories

User stories that Maintainer test stories validate:

- [001 - Basic Navigation & Action](../stories/001-basic-nav-action.md)
  (tested by [010](../stories/010-instruction-parsing-tests.md))
- [002 - Data Extraction](../stories/002-data-extraction.md)
  (tested by [011](../stories/011-extraction-accuracy-tests.md))
- [004 - Loop / Paginated Scraping](../stories/004-loop-pagination.md)
  (tested by [012](../stories/012-loop-safety-tests.md))
