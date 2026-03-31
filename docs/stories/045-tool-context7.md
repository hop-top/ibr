# 045 - Tool: context7

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Look up library or framework documentation and get a focused answer to a
specific question without manually navigating docs sites.

## Stories

- As a CLI user, I run `ibr tool context7 --param library=playwright --param
  question="how to click an element"` to get a concise answer from the docs.
- As a CLI user, I pass `--param version=1.40` to scope lookup to a specific
  release.
- As an AI coding assistant, I invoke context7 to resolve a library API
  question in-context without a web search.

## Acceptance Criteria

- `ibr tool context7 --param library=<lib> --param question=<q>` runs without
  error and outputs an answer.
- `version` defaults to empty (latest) when omitted.
- Missing `library` param → non-zero exit with "Missing required param: library".
- Missing `question` param → non-zero exit with "Missing required param: question".
- Tool navigates to context7.com/<library> and extracts a concise answer with
  any relevant code examples.

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation for `library` and `question`.
