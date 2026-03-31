# 057 - Tool: dockerhub

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Search Docker Hub for container images; extract pull counts, star counts,
official status, and optionally the 10 most recent tags for the top result.

## Stories

- As a CLI user, I run `ibr tool dockerhub --param image=nginx` to get the top
  Docker Hub results for nginx with pull counts and metadata.
- As a CLI user, I pass `--param max_results=10` to control how many results
  are returned (default 5).
- As a CLI user, I pass `--param show_tags=true` to also retrieve the 10 most
  recent tags from the top result.
- As a CLI user, omitting `image` produces a non-zero exit with a clear error.

## Acceptance Criteria

- Navigates to `https://hub.docker.com/search?q={{image}}&type=image`.
- Extracts up to `max_results` results; each item contains: `name`,
  `description`, `pull_count`, `star_count`, `official`, `url`.
- When `show_tags=true`: navigates to the top result and extracts up to 10
  tags with `tag`, `digest`, `last_pushed`.
- Missing required param `image` → non-zero exit with "Missing required param: image".
- Exit code 0 on successful extraction; stdout contains "Task execution completed".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation.
