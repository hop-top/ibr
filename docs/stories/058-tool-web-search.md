# 058 - Tool: web-search

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search the web and return ranked results with titles, URLs, and snippets
without constructing the prompt manually.

## Stories

- As a CLI user, I run `ibr tool web-search --param query="openai agents"` to
  retrieve ranked web results.
- As a CLI user, I pass `--param count=10` to increase the number of results.
- As an AI coding assistant, I invoke web-search to perform research inline.

## Acceptance Criteria

- `ibr tool web-search --param query=<q>` runs without error and outputs
  results with title, URL, and snippet.
- `count` defaults to 5 when omitted.
- Missing `query` param → non-zero exit with "Missing required param: query".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation for `query`.
