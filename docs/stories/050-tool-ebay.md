# 050 - Tool: ebay

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search eBay listings and extract pricing data — including sold/completed prices —
from the CLI without a browser.

## Stories

- As a CLI user, I run `ibr tool ebay --param query="iphone 15 pro"` to find
  current listings with title, price, condition, and URL.
- As a CLI user, I pass `--param sold=true` to see only sold/completed listings
  for accurate market-price research.
- As a CLI user, I pass `--param country=co.uk` to search the UK eBay site.
- As a CLI user, I pass `--param max_results=10` to get more results.

## Acceptance Criteria

- `ibr tool ebay --param query=<query>` exits 0 and returns listings.
- Each listing includes: title, price, condition, sold status, listing URL.
- `sold` defaults to `false`; passing `--param sold=true` appends
  `LH_Sold=1&LH_Complete=1` to the eBay URL.
- `country` defaults to `com`; other TLDs (co.uk, de, etc.) produce the correct
  domain.
- `max_results` defaults to `5`.
- Missing `query` → non-zero exit with "Missing required param: query".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors;
  required param validation.
