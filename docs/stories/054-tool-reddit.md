# 054 - Tool: reddit

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search Reddit for posts matching a query and extract structured metadata
(title, subreddit, score, comment count, URL, snippet) for each result.

## Stories

- As a CLI user, I run `ibr tool reddit --param query=rust async` to retrieve
  a list of Reddit posts with title, subreddit, score, comment_count, url, and snippet.
- As a CLI user, I pass `--param subreddit=rust` to scope results to a single subreddit.
- As a CLI user, I pass `--param sort=hot` to sort by hot posts.
- As a CLI user, I pass `--param max_results=10` to control how many results are returned.
- As a CLI user, omitting `query` produces a non-zero exit with a clear error message.

## Acceptance Criteria

- Navigates to `https://www.reddit.com/search/?q={{query}}&sort={{sort}}` by default.
- When `subreddit` is set, navigates to
  `https://www.reddit.com/r/{{subreddit}}/search/?q={{query}}&sort={{sort}}` instead.
- Extracts up to `max_results` (default 5) posts per run.
- Each extracted item contains: `title`, `subreddit`, `score`, `comment_count`,
  `url`, `snippet`.
- `sort` defaults to `relevance`; accepted values: relevance, hot, new, top.
- Missing required param `query` → non-zero exit with "Missing required param: query".
- Exit code 0 on successful extraction; stdout contains "Task execution completed".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required param
  validation.
