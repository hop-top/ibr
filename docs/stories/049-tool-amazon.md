# 049 - Tool: amazon

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search Amazon for products and extract structured data (title, price, rating,
review count, ASIN) without manual browsing.

## Stories

- As a CLI user, I run `ibr tool amazon --param query="noise cancelling headphones"`
  to get the top 5 product listings with prices and ratings.
- As a CLI user, I pass `--param max_results=10` to retrieve more results.
- As a CLI user, I pass `--param country=co.uk` to search amazon.co.uk.
- As an AI coding assistant, I invoke amazon to compare product options and
  prices programmatically.

## Acceptance Criteria

- `ibr tool amazon --param query=<q>` exits 0 and returns product listings.
- `max_results` defaults to `5`; `country` defaults to `com`.
- Missing `query` → non-zero exit with "Missing required param: query".
- Tool navigates to `https://www.<country>/s?k=<query>` and extracts up to
  `max_results` products with title, price, rating, review count, and ASIN.

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation for `query`.
