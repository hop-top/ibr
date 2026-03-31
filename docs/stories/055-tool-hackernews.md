# 055 - Tool: hackernews

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search Hacker News via Algolia and extract structured metadata (title, points,
comment count, author, URL, HN URL) for each result.

## Stories

- As a CLI user, I run `ibr tool hackernews --param query=rust async` to retrieve
  a list of HN posts with title, points, comment_count, author, url, and hn_url.
- As a CLI user, I pass `--param type=job` to filter to job posts.
- As a CLI user, I pass `--param sort=date` to sort by most recent.
- As a CLI user, I pass `--param max_results=5` to control how many results are returned.
- As a CLI user, omitting `query` produces a non-zero exit with a clear error message.

## Acceptance Criteria

- Navigates to `https://hn.algolia.com/?q={{query}}&type={{type}}&sort=by{{sort}}`.
- Extracts up to `max_results` (default 10) items per run.
- Each extracted item contains: `title`, `points`, `comment_count`, `author`,
  `url`, `hn_url`.
- `type` defaults to `story`; accepted values: story, comment, job, poll.
- `sort` defaults to `popularity`; accepted values: date, popularity.
- Missing required param `query` → non-zero exit with "Missing required param: query".
- Exit code 0 on successful extraction; stdout contains "Task execution completed".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required param
  validation.
