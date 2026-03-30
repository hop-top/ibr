# 022 - Dialog Handling

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Browser dialogs (alert/confirm/prompt/beforeunload) don't block or timeout task execution.

## Stories

- As a CLI user, browser dialogs are auto-accepted so tasks run uninterrupted.
- As a CLI user, dialog history is buffered and accessible for post-run inspection.
- As a CLI user, dialog behaviour is configurable via env vars without code changes.

## Acceptance Criteria

- `DIALOG_AUTO_ACCEPT=true` (default) — dialogs auto-accepted; no 30s Playwright timeouts.
- `DIALOG_AUTO_ACCEPT=false` — dialogs auto-dismissed.
- `DIALOG_BUFFER_CAPACITY` (default 50000) — controls max buffered dialog events.
- `DIALOG_DEFAULT_PROMPT_TEXT` (default `''`) — text submitted for `prompt()` dialogs.
- `beforeunload` dialogs always accepted with empty string regardless of
  `DIALOG_DEFAULT_PROMPT_TEXT`.
- Buffer accessible programmatically via `DialogManager#getBuffer()` and
  `DialogManager#getRecentDialogs(n)`.
- Buffer flushed between tasks via `DialogManager#clear()`.
- Dialog messages >512 chars are truncated before buffering.
- Rapid-fire dialogs (<100ms apart) logged as warning; all entries still buffered.
- Navigation-triggered dialog dismissal (accept throws) swallowed silently;
  entry recorded with `action='accept-failed'`.
