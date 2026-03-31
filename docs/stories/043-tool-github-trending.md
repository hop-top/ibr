# 043 - Tool: github-trending

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Browse GitHub trending repositories filtered by language and time period.

## Stories

- As a CLI user, I run `ibr tool github-trending` to see today's top trending
  repos across all languages.
- As a CLI user, I run `ibr tool github-trending --param language=go` to
  scope to Go repos.
- As a CLI user, I pass `--param period=weekly` to see weekly trending.
- As a CLI user, I pass `--param count=25` to get more repos.

## Acceptance Criteria

- `ibr tool github-trending` (no params) runs without error; all params optional.
- `language` defaults to `""` (all languages) when omitted.
- `period` defaults to `daily` when omitted; valid values: daily, weekly, monthly.
- `count` defaults to `10` when omitted.
- Language and period are interpolated directly into the URL:
  `https://github.com/trending/{{language}}?since={{period}}`.
- Extraction includes: repo name (owner/name), description, language,
  stars today, total stars.

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0 with no params; exits 0
  with language + period params.
