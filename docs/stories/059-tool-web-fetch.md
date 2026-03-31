# 059 - Tool: web-fetch

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Fetch any URL and extract its main content as clean readable text without
writing a full ibr prompt.

## Stories

- As a CLI user, I run `ibr tool web-fetch --param url=https://example.com/article`
  to extract the article's main content.
- As a CLI user, I pass `--param selector=#main` to scope extraction to a
  specific element.
- As an AI coding assistant, I invoke web-fetch to read a page's content
  in-context.

## Acceptance Criteria

- `ibr tool web-fetch --param url=<url>` runs without error and outputs clean
  text content.
- `selector` defaults to empty (full page) when omitted.
- Missing `url` param → non-zero exit with "Missing required param: url".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation for `url`.
