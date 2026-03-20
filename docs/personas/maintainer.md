# Maintainer

## Description

Developer writing and running automated tests for the idx project to ensure
correctness across changes. Cares about test coverage, regression prevention,
DOM simplification fidelity, and AI prompt stability.

## Stories

- [010 - Instruction Parsing Tests](../stories/010-instruction-parsing-tests.md)
- [011 - Extraction Accuracy Tests](../stories/011-extraction-accuracy-tests.md)
- [012 - Loop Safety Tests](../stories/012-loop-safety-tests.md)

## Related Stories

User stories that Maintainer test stories validate:

- [001 - Basic Navigation & Action](../stories/001-basic-nav-action.md)
  (tested by [010](../stories/010-instruction-parsing-tests.md))
- [002 - Data Extraction](../stories/002-data-extraction.md)
  (tested by [011](../stories/011-extraction-accuracy-tests.md))
- [004 - Loop / Paginated Scraping](../stories/004-loop-pagination.md)
  (tested by [012](../stories/012-loop-safety-tests.md))
