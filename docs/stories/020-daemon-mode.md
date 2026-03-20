# 020 - Daemon Mode

**Persona:** [Automated Workflow](../personas/automated-workflow.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Keep a browser process alive across invocations so repeated idx calls
skip cold-start overhead; targeted at tight loops, agents, and CI pipelines
where the same browser context is reused.

## Stories

- As an automated workflow, I set `IDX_DAEMON=true` so idx connects to a
  background server instead of launching a new browser each call.
- As an automated workflow, the daemon auto-starts on the first call when
  no live server exists; I don't need to run `npm run server` manually.
- As an automated workflow, subsequent calls connect to the running server
  and complete significantly faster than a cold-start invocation.
- As an AI coding assistant, I use `--daemon` per-invocation to opt into
  daemon mode without exporting env vars.
- As an automated workflow, the daemon shuts itself down after 30 min idle
  so it doesn't consume resources indefinitely.
- As an automated workflow, if the daemon crashes between calls it is
  transparently restarted on the next invocation without manual intervention.

## Acceptance Criteria

- `IDX_DAEMON=true idx "<prompt>"` starts a background server on first call
  and reuses it on subsequent calls.
- `idx --daemon "<prompt>"` behaves identically to `IDX_DAEMON=true`.
- `GET /health` on the daemon port returns `{ status: "healthy" }`.
- `POST /command` with a valid Bearer token returns extracted data as plain text.
- `POST /command` without or with wrong Bearer token returns HTTP 401.
- Server state file written to `IDX_STATE_FILE` (or `~/.idx/server.json`)
  with mode `0600`; contains `pid`, `port`, `token`.
- Exit code 0 on successful command; non-zero on server error.
- Daemon process keeps running between invocations (pid unchanged).
