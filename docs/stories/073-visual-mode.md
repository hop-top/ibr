# 073 - Visual Mode & Auto-Escalation

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Resolve elements and read values from a screenshot when the text
representations (aria / dom) cannot describe the page — canvas apps,
unlabelled SPAs, obstructions such as modals — without adding an image
library or a second overlay engine.

## Stories

- As a CLI user, I run `ibr --mode visual "…"` so each find/extract
  instruction is answered from a screenshot with Set-of-Marks labels
  (`@e1`, `@c2`, …) drawn on candidate elements; the model replies with a
  label, never raw pixel coordinates.
- As a CLI user, on a page with no detectable interactive elements the
  overlay falls back to a labelled grid (`VISUAL_GRID`, default `8x8`,
  cells `r0c0`…) and my click lands on the chosen cell's centre.
- As a CLI user, `extract` instructions in visual mode read the value from
  the image and land it in the same `.extracts` output as text extraction.
- As a CLI user in the default `--mode auto`, when the aria/dom find
  succeeds but the action on the found element throws, ibr escalates to a
  visual attempt for that instruction before healing, capped per run by
  `VISUAL_MAX_ESCALATIONS` (default 3); explicit `--mode visual` ignores
  the cap.
- As a CLI user, every escalation is visible: a `visual.escalation` /
  `visual.escalation_capped` progress event and a log line naming the
  executed target (`visual-mark=@e6`, `visual-grid=r0c0`).
- As a CLI user, `--mode visual --annotate` both sends the marked frame to
  the model and writes it to disk — two sinks of one overlay engine.
- As a CLI user, I set `VISUAL_AI_MODEL` to route only the image calls to a
  vision-capable model while the rest of the run keeps `AI_MODEL`.

## Acceptance Criteria

- `--mode visual` is accepted by the CLI; an invalid mode's error lists it.
- Marks are drawn in-browser (injected DOM/CSS + Playwright screenshot);
  no `sharp`/`canvas` dependency. `--annotate` and `snap -a` output is
  byte-identical to before the overlay core was shared.
- Element strategy when ≥1 interactive element is detected; grid strategy
  otherwise. Mark labels are the drawn ref strings, keyed 1:1 in `markMap`.
- A model reply naming a label absent from `markMap` is a find miss (skip),
  never a crash.
- Auto-escalation triggers when a found element's action throws, is
  per-instruction, counts against the cap, and emits a cap-hit note when
  denied. A failed visual attempt falls through to healing with the
  screenshot attached (visual-informed hypothesis); with no image,
  `HealingService.attemptHeal` behaves exactly as before.
- An empty text find is not an escalation trigger: a zero-element reply
  also means "nothing to do" (page-level `scroll`, optional actions), so
  the instruction is skipped as before. Escalating on a genuine find miss
  needs a miss-vs-no-op signal in the action reply first (follow-up).
- A non-vision `VISUAL_AI_MODEL` fails with `CONFIG_ERROR`, not a silent
  bad result.

## E2E Coverage

**Existing E2E coverage**

- [cli-visual-mode.test.js](../../test/e2e/cli-visual-mode.test.js) — real
  Chromium, faked AI (`startFakeAIServerE2E`), browser-gated like the rest
  of `test/e2e/**`:
  - element strategy: `{mark:"@e6"}` resolves the cookie-accept button on
    `modal-page.html`; asserts the `Clicking element` line carries
    `visual-mark=@e6` and `executed successfully` follows (run at
    `LOG_LEVEL=info`), plus inverse guards for the skip/grid/error paths.
  - grid fallback: `empty-page.html` → cell `r0c0` clicked at its real
    centre `(80,45)` on the 1280×720 viewport.
  - extract-from-image: the model's read of `product-page.html` lands as
    `[[{ price: '$9.99' }]]` in the output file.

**Unit coverage (no browser)**

- [Operations.visual-escalation.test.js](../../test/unit/Operations.visual-escalation.test.js)
  — act-failure escalation (a–g): before healing, cap, explicit-visual
  exemption, `visual.escalation` event, heal receives the image only when a
  visual attempt ran.
- Explicit `--mode visual` Operations tests, `AnnotationService` buffer/grid
  sink tests, provider image-part tests, visual prompt tests.

**Expected E2E coverage for full criteria**

- `--mode auto` escalation end-to-end (a found element whose click throws,
  then the visual mark lands), including the `visual.escalation` NDJSON
  event and the cap-hit note.
- Escalation on a genuine find miss (canvas / unlabelled pages where
  aria/dom resolves nothing) — blocked on distinguishing a miss from a
  deliberate no-op in the action reply.
- `--mode visual --annotate` producing both the model call and the
  on-disk marked frame.
- `fill` / `type` in visual mode with a real value — the visual find
  currently carries no value (tracked as a follow-up).
