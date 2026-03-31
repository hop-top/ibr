# 053 - Tool: producthunt

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search Product Hunt for products matching a query and extract structured data
(name, tagline, upvote count, URL, maker) for each result.

## Stories

- As a CLI user, I run `ibr tool producthunt --param query=notion` to retrieve
  a list of products with names, taglines, upvote counts, URLs, and makers.
- As a CLI user, I pass `--param max_results=10` to control how many products
  are returned (default 5).
- As a CLI user, omitting `query` produces a non-zero exit with a clear error.

## Acceptance Criteria

- Navigates to `https://www.producthunt.com/search?q=<query>`.
- Extracts up to `max_results` (default 5) products per run.
- Each extracted item contains: `name`, `tagline`, `upvotes`, `url`, `maker`.
- Missing required param `query` → non-zero exit with "Missing required param: query".
- Exit code 0 on successful extraction; stdout contains "Task execution completed".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation.
