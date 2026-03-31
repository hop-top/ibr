# 046 - Tool: arxiv

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search arXiv for academic papers and extract structured metadata (title, authors,
abstract, URL) without manual browsing.

## Stories

- As a CLI user, I run `ibr tool arxiv --param query=attention transformers` to
  get a ranked list of papers with abstracts.
- As a CLI user, I add `--param max_results=10` to retrieve more papers.
- As a CLI user, I add `--param category=cs.LG` to scope results to a specific
  arXiv subject area.

## Acceptance Criteria

- `query` is required; omitting it → non-zero exit with message referencing
  `query` or "required param".
- With valid `query`, exits 0 and stdout contains "Task execution completed".
- `max_results` defaults to 5; `category` defaults to empty (no filter).
- Extracted records include at minimum: title, authors, abstract, arxiv-url.

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, task completes; required
  param validation for `query`.
