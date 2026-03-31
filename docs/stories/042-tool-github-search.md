# 042 - Tool: github-search

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search GitHub across repositories, code, issues, and users from the CLI.

## Stories

- As a CLI user, I run `ibr tool github-search --param query=playwright` to
  find repositories matching "playwright".
- As a CLI user, I pass `--param type=issues` to search issues instead.
- As a CLI user, I pass `--param count=20` to get more results.

## Acceptance Criteria

- `ibr tool github-search --param query=<query>` runs without error.
- `type` defaults to `repositories` when omitted.
- `count` defaults to `10` when omitted.
- Missing `query` param → non-zero exit with "Missing required param: query".
- Tool navigates to GitHub search, sets type filter, enters query, and extracts
  results with type-appropriate fields (name/description/stars for repos;
  title/status/date for issues; etc.).

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors.
