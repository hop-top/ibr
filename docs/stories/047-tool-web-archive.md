# 047 - Tool: web-archive

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Retrieve and extract content from archived snapshots of any URL via the
Wayback Machine without manually navigating archive.org.

## Stories

- As a CLI user, I run `ibr tool web-archive --param url=https://example.com`
  to fetch the most recent archived snapshot.
- As a CLI user, I pass `--param date=20230101` to target a specific snapshot
  date.
- As an AI coding assistant, I invoke web-archive to access historical page
  content that may no longer be live.

## Acceptance Criteria

- `ibr tool web-archive --param url=<url>` runs without error and extracts
  main page content.
- `date` defaults to empty (latest snapshot) when omitted.
- Missing `url` param → non-zero exit with "Missing required param: url".
- Tool navigates to web.archive.org and extracts textual content from the
  archived snapshot.

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation for `url`.
