# 021 - Visual Debugging (Annotated Screenshots)

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Visually confirm which elements the AI targeted by capturing annotated PNG
screenshots with bounding-box overlays labeled `@e1`, `@e2`, `@c1`, etc.

## Stories

- As a CLI user, I run `idx --annotate "..."` (or `-a`) to get a screenshot
  after each element-resolution step showing red boxes around the elements
  the AI found — without modifying my prompt or workflow.
- As a CLI user, I set `ANNOTATED_SCREENSHOTS_ON_FAILURE=true` so idx
  automatically captures a labeled screenshot whenever an action fails,
  giving me instant visual context for debugging without re-running.
- As a CLI user, screenshots land in `/tmp` with predictable names
  (`idx-annotate-step-N-<ts>.png`, `idx-failure-step-N-<ts>.png`) so I
  can find them quickly after a run.
- As a CLI user, overlay injection never breaks my task — CSP errors,
  hidden elements, and screenshot failures are all handled silently.

## Acceptance Criteria

- `--annotate` / `-a`: after each `#findElements` returning ≥1 element,
  full-page PNG written to `/tmp/idx-annotate-step-<N>-<ts>.png`.
- `ANNOTATED_SCREENSHOTS_ON_FAILURE=true`: on `#actionInstruction` failure,
  PNG written to `/tmp/idx-failure-step-<N>-<ts>.png`; error is non-fatal.
- Overlays: red 2px border + semi-transparent red fill + ref label
  (`@e1`…`@eN` for DOM elements, `@c1`…`@cN` for pseudo-buttons).
- Off-screen / hidden elements (`boundingBox()` → null or throws): skipped,
  no overlay, no error.
- No visible elements after bbox fetch: returns `{success:false}`,
  no screenshot written.
- CSP blocks `page.evaluate`: caught, warning logged, execution continues.
- Overlay divs always removed in `finally` block (even on screenshot error).
- Path validation: rejects paths outside `/tmp` or `cwd`; logs warning,
  returns `{success:false}`.
- Bounding boxes fetched in parallel batches of max 50 concurrent.
- `AnnotationService` has no external image-library dependency (pure DOM).
