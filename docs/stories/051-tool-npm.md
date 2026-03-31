# 051 - Tool: npm

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Fetch npm package metadata — version, downloads, license, dependents — from
the CLI without leaving the terminal.

## Stories

- As a CLI user, I run `ibr tool npm --param package=react` to get the latest
  version, weekly downloads, license, and dependent count for React.
- As an AI coding assistant, I call this tool to check a package's health
  (downloads, dependents, license) before recommending it.

## Acceptance Criteria

- `ibr tool npm --param package=<name>` exits 0 and returns package metadata.
- Output includes: name, version, description, weekly_downloads, license,
  homepage, github repo URL, dependents count.
- Missing `package` → non-zero exit with "Missing required param: package".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors;
  required param validation.
