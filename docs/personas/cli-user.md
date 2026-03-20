# CLI User

## Description

Developer invoking `idx` from the terminal using natural language instructions.
Cares about expressive, readable prompt syntax; reliable element detection;
clear error messages; and observable execution (logs, browser window).

## Stories

- [001 - Basic Navigation & Action](../stories/001-basic-nav-action.md)
- [002 - Data Extraction](../stories/002-data-extraction.md)
- [003 - Conditional Actions](../stories/003-conditional-actions.md)
- [004 - Loop / Paginated Scraping](../stories/004-loop-pagination.md)
- [005 - AI Provider Selection](../stories/005-ai-provider-selection.md)
- [006 - Debug & Observability](../stories/006-debug-observability.md)
- [019 - Authenticated Session Cookies](../stories/019-authenticated-session-cookies.md)

## Related Stories

Stories where CLI User functionality is validated by another persona:

- [010 - Instruction Parsing Tests](../stories/010-instruction-parsing-tests.md)
  (Maintainer validates [001](../stories/001-basic-nav-action.md))
- [011 - Extraction Accuracy Tests](../stories/011-extraction-accuracy-tests.md)
  (Maintainer validates [002](../stories/002-data-extraction.md))
- [012 - Loop Safety Tests](../stories/012-loop-safety-tests.md)
  (Maintainer validates [004](../stories/004-loop-pagination.md))
