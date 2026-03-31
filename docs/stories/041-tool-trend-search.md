# 041 - Tool: trend-search

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Explore Google Trends interest data for any topic without constructing
the prompt manually.

## Stories

- As a CLI user, I run `ibr tool trend-search --param topic=javascript` to
  see trending interest over time for "javascript".
- As a CLI user, I pass `--param region=GB` to scope trends to Great Britain.
- As a CLI user, I pass `--param period=30d` to see a 30-day window.

## Acceptance Criteria

- `ibr tool trend-search --param topic=<topic>` runs without error.
- `region` defaults to `US` when omitted.
- `period` defaults to `7d` when omitted.
- Missing `topic` param → non-zero exit with "Missing required param: topic".
- Tool navigates to Google Trends explore page and extracts interest-over-time
  data and related queries (rising + top).

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors.
- `test/e2e/cli-tool-subcommand.test.js` — missing param → non-zero (via
  trend-search's required `topic` param).
