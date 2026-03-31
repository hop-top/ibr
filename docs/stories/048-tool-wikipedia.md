# 048 - Tool: wikipedia

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Look up a Wikipedia article and extract its intro summary (and optionally a
specific section) without opening a browser manually.

## Stories

- As a CLI user, I run `ibr tool wikipedia --param topic=Playwright` to get
  the intro summary of the Playwright article.
- As a CLI user, I pass `--param section=History` to extract a specific section
  in addition to the intro.
- As a CLI user, I pass `--param lang=fr` to read the French Wikipedia edition.
- As an AI coding assistant, I invoke wikipedia to fetch background facts about
  a topic in-context.

## Acceptance Criteria

- `ibr tool wikipedia --param topic=<t>` exits 0 and outputs an intro summary.
- `lang` defaults to `en`; `section` defaults to empty (intro only).
- Missing `topic` → non-zero exit with "Missing required param: topic".
- Tool navigates to `https://<lang>.wikipedia.org/wiki/<topic>` and extracts
  the intro and (if set) the requested section text.

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation for `topic`.
