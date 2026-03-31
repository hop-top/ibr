# 056 - Tool: yahoo-finance

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Fetch a live stock quote and key financial statistics for any ticker symbol
from Yahoo Finance — price, change, market cap, P/E, EPS, 52-week range, volume.

## Stories

- As a CLI user, I run `ibr tool yahoo-finance --param ticker=AAPL` to get the
  current Apple stock quote with key stats in structured output.
- As a CLI user, I pass `--param ticker=TSLA` or any valid ticker symbol to
  retrieve that company's data.
- As a CLI user, omitting `ticker` produces a non-zero exit with a clear error.

## Acceptance Criteria

- Navigates to `https://finance.yahoo.com/quote/{{ticker}}/` with the ticker
  interpolated.
- Extracts: `ticker`, `company_name`, `price`, `change`, `change_percent`,
  `market_cap`, `pe_ratio`, `eps`, `week_52_high`, `week_52_low`, `volume`,
  `avg_volume`.
- Missing required param `ticker` → non-zero exit with "Missing required param: ticker".
- Exit code 0 on successful extraction; stdout contains "Task execution completed".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation.
