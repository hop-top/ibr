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
- As a CLI user, I run `ibr --annotate` (or `-a`) to get a PNG screenshot after
  each element-resolution step, showing red bounding-box overlays labeled
  `@e1`, `@e2`, `@c1`, etc. — so I can visually confirm what the AI targeted.
- As a CLI user, I set `ANNOTATED_SCREENSHOTS_ON_FAILURE=true` so ibr
  automatically captures an annotated screenshot whenever an action fails —
  letting me diagnose issues without re-running with `--annotate`.
- As a CLI user, I set `NDJSON_STREAM=true` to receive one JSON object per
  line on stdout for each browser event (navigation, click, extract, error),
  enabling real-time pipeline integration or structured log ingestion.

## Acceptance Criteria

- `BROWSER_HEADLESS=false` opens a visible Chromium window.
- `BROWSER_SLOWMO` delays each action by the specified ms.
- `DEBUG=*` emits structured logs to stderr/log file.
- Each log entry identifies: step index, action type, element resolved,
  tokens used, outcome (success/skip/error).
- `--annotate` / `-a` flag: after each `#findElements` call that returns ≥1
  element, captures a full-page PNG to `/tmp/ibr-annotate-step-N-<ts>.png`
  with red overlays + ref labels injected via DOM `page.evaluate`.
- `ANNOTATED_SCREENSHOTS_ON_FAILURE=true`: on any `#actionInstruction` catch,
  captures PNG to `/tmp/ibr-failure-step-N-<ts>.png`; non-fatal (never
  propagates screenshot errors).
- Overlay cleanup always runs (finally block); CSP failures are caught and
  logged as warnings; execution continues without screenshot.
- Path validation rejects paths outside `/tmp` or `cwd`; returns
  `{success:false}` without throwing.
- `NDJSON_STREAM=true`: each browser event emits one JSON line to stdout:
  `{event, timestamp, ...eventFields}`. Events: task_start, navigation,
  action, extract, error, task_end.
- Disabled by default; no output when unset.
- Stream write errors are swallowed — observability never breaks core flow.
