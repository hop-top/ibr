# 044 - Tool: github-starred

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Browse any GitHub user's starred repositories, optionally filtering by keyword.

## Stories

- As a CLI user, I run `ibr tool github-starred --param username=sindresorhus`
  to list their starred repos.
- As a CLI user, I pass `--param query=rust` to filter starred repos by keyword.
- As a CLI user, I pass `--param count=20` to get more results.

## Acceptance Criteria

- `ibr tool github-starred --param username=<user>` runs without error.
- Missing `username` param → non-zero exit with "Missing required param: username".
- `query` defaults to `""` (no filter) when omitted.
- `count` defaults to `10` when omitted.
- When `query` is non-empty, tool types it into the filter box before extracting.
- Extraction includes: name, description, primary language, star count per repo.

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0 with username; missing
  username → non-zero exit before browser.
