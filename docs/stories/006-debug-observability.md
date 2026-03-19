# 006 - Debug & Observability

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Observe execution in real-time and access structured logs to diagnose failures.

## Stories

- As a CLI user, I set `BROWSER_HEADLESS=false` to watch the browser window
  execute instructions live.
- As a CLI user, I set `BROWSER_SLOWMO=500` to slow down interactions and
  spot where a flow breaks.
- As a CLI user, I enable `DEBUG=*` to get per-step logs including AI prompts,
  token counts, element resolution, and action outcomes.
- As a CLI user, log output is written to `logs/` for post-run inspection.

## Acceptance Criteria

- `BROWSER_HEADLESS=false` opens a visible Chromium window.
- `BROWSER_SLOWMO` delays each action by the specified ms.
- `DEBUG=*` emits structured logs to stderr/log file.
- Each log entry identifies: step index, action type, element resolved,
  tokens used, outcome (success/skip/error).
