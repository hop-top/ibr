# Story: Augmentation Integration

As a user, I want `ibr` to automatically apply domain-specific augmentations (like removing paywalls or silencing noise) based on the target URL, so that the AI handles complex pages more reliably and with fewer tokens.

## Acceptance Criteria

- [x] `ibr` matches the target URL against regex patterns in `~/.ibr/augmentations.json`.
- [ ] If a match is found, specified DOM mutations (remove, isolate, addClass) are applied before taking a snapshot.
- [x] Custom JavaScript scripts (`evaluateBeforeSnapshot`) are executed in the browser context.
- [x] The `--raw` or `--ignore-augmentations` flag bypasses all augmentations.
- [ ] Augmentations are recorded in the task's observability stream.

## Scenarios

### Successful Augmentation
**Given** an augmentation rule exists for `example.com` to remove elements matching `.paywall`.
**When** I run `ibr "url: https://example.com\ninstructions:\n - extract the title"`
**Then** the `.paywall` element should be removed from the DOM *before* the AI sees it.

### Bypass Augmentations
**Given** an augmentation rule exists for `example.com`.
**When** I run `ibr --raw "url: https://example.com\ninstructions:\n - extract the title"`
**Then** the DOM should be processed without any mutations.

## E2E Coverage

**Existing E2E coverage** — [augmentation.test.js](../../test/e2e/augmentation.test.js):

- `should apply augmentation rules from file` — proves URL-regex matching
  against `IBR_AUGMENTATIONS_FILE` (`.*product-page\.html`) and that the
  matched rule's `domMutations.remove` is applied before the snapshot
  (asserts the `Applying augmentations to page` log + the rule id). Covers
  criterion 1 and the `remove` half of criterion 2.
- `should bypass augmentations with --raw flag` — proves `--raw` skips all
  augmentations (no `Applying augmentations to page`), even for a catch-all
  `remove: ['body']` rule. Covers criterion 4 (`--raw`).
- `should bypass augmentations with --ignore-augmentations flag` — proves the
  `--ignore-augmentations` alias also bypasses. Covers criterion 4 (the OR
  alternative).
- `should execute evaluateBeforeSnapshot script in the browser before snapshot`
  — proves the `scripting.evaluateBeforeSnapshot` string is eval'd in the page
  context: a script-only rule (no `domMutations`) removes the full-screen
  `.modal` overlay from `paywall-a.html`, so the subsequent click on `#target`
  lands directly and **Heal Mode is never entered**. If the script had not run,
  the fixed `z-index:9999` modal would intercept the click and trigger healing;
  asserting healing is absent pins in-browser script execution. Covers
  criterion 3.

**Expected E2E coverage for full criteria** (not yet asserted):

- Criterion 2 (`isolate`, `addClass`) — only `remove` is exercised. Add cases
  driving `domMutations.isolate` and `domMutations.addClass` and asserting the
  resulting DOM shape reaches the snapshot.
- Criterion 5 (observability stream) — no test inspects the NDJSON /
  observability stream for an augmentation-applied event. Add a case with
  `NDJSON_STREAM=true` (or the observability buffer) asserting the augmentation
  is recorded.
