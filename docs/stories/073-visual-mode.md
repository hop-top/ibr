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
- As a CLI user, a `fill`/`type`/`press` that resolves to a grid cell
  performs the action I asked for with the value I gave: the cell centre is
  clicked to focus, then `page.keyboard.type`/`press` applies the value —
  it is not downgraded to a bare click that drops it. A missing value is
  refused with `MISSING_ACTION_VALUE` rather than silently degraded.
- As a CLI user, an action the visual path cannot perform against a mark —
  `scroll` above all — is refused rather than substituted. Performing some
  other action (scrolling to the model's guess, wheel-scrolling at a cell)
  would silently do something different from what I asked; earlier versions
  fell through to a click.
- As a CLI user in `--mode auto`, a genuine find miss (`"outcome":
  "not_found"`) escalates to a visual attempt, while an instruction the
  model marks `"no_element_needed"` — a page-level scroll, an optional
  action — is skipped as before and spends no escalation or vision call.
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
- Auto-escalation triggers at two failure points — a found element's action
  throws, or the find reports a genuine miss — is per-instruction, counts
  against the cap, and emits a cap-hit note when denied. A failed visual
  attempt on the act-failure path falls through to healing with the
  screenshot attached (visual-informed hypothesis); with no image,
  `HealingService.attemptHeal` behaves exactly as before. On the find-miss
  path there is no locator or action error to heal, so an unresolved visual
  attempt leaves the instruction skipped.
- The action reply carries an `outcome` field disambiguating the two
  meanings of a zero-element reply: `not_found` (genuine miss, escalates)
  vs `no_element_needed` (page-level `scroll`, optional action — skipped,
  no escalation, no vision call). The field is additive: absent or
  unrecognised values normalise to `undefined` and keep the historical
  silent skip, so pre-existing callers and cassettes stay valid.
- The visual path performs `click`, `fill`, `type` and `press` only
  (`VISUAL_ACTION_TYPES`). Anything else is refused, never downgraded to a
  click, guarded at three depths: the allowlist, a short-circuit before the
  screenshot/vision call, and a throw in the grid executor
  (`UNSUPPORTED_VISUAL_ACTION`); the element-locator escalation executor
  throws the same code, while the explicit `--mode visual` locator flow logs
  the refusal and skips the step.
- A grid-cell target honours the resolved action type and value: the centre
  is clicked to focus, then `page.keyboard.type`/`press` applies the value;
  `click` remains the mouse click alone. A missing value raises
  `MISSING_ACTION_VALUE` rather than degrading to a bare click, and the
  action event's `valueLength` reports the real length.
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
  visual attempt ran; find-miss escalation gated on `outcome: "not_found"`.
- [Operations.visual-mode.test.js](../../test/unit/Operations.visual-mode.test.js)
  — explicit `--mode visual` resolution; `fill`/`type`/`press` carrying the
  real value on both element marks and grid cells; a valueless grid `fill`
  refused rather than downgraded to a click; grid telemetry reporting the
  real `valueLength`; and a `scroll` clicking neither an element mark nor a
  cell centre.
- [baml-parser.typed.test.js](../../test/unit/ai/baml-parser.typed.test.js)
  — `outcome` normalisation: the three known values pass through, anything
  else (absent, unrecognised, non-string) becomes `undefined`.
- [prompts.test.js](../../test/unit/utils/prompts.test.js) — both action
  instruction prompts (aria + dom) request the `outcome` field and describe
  all three cases.
- `AnnotationService` buffer/grid sink tests, provider image-part tests.

**Expected E2E coverage for full criteria**

- `--mode auto` escalation end-to-end (a found element whose click throws,
  then the visual mark lands), including the `visual.escalation` NDJSON
  event and the cap-hit note.
- Escalation on a genuine find miss end-to-end (canvas / unlabelled pages
  where aria/dom resolves nothing and the model replies `not_found`), and
  the `no_element_needed` counterpart asserting no escalation is spent.
- `--mode visual --annotate` producing both the model call and the
  on-disk marked frame.
- A refused `scroll` on the visual path end-to-end — the skip under
  `--mode auto` (no screenshot, no escalation spent) and the
  `UNSUPPORTED_VISUAL_ACTION` stderr object on a grid cell.
