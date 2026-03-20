# 005 - AI Provider Selection

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Choose the AI backend (OpenAI, Anthropic, Google) via environment variables
without code changes.

## Stories

- As a CLI user, I set `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` to
  switch idx to Claude without modifying any source files.
- As a CLI user, I override the default model with `AI_MODEL` when I need
  a specific version.
- As a CLI user, missing or invalid provider config produces a clear startup
  error before any browser is launched.

## Acceptance Criteria

- Supports `openai`, `anthropic`, `google` providers via `AI_PROVIDER`.
- Validates presence of the corresponding API key at startup.
- `AI_MODEL` overrides provider default when set.
- Unknown `AI_PROVIDER` value exits with non-zero and descriptive message.
