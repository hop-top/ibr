# Story: Self-Healing Bypass

As a user, I want `ibr` to autonomously identify and bypass page obstructions (like new paywall modals) that weren't previously recorded, and save the solution for future runs.

## Acceptance Criteria

- [x] `ibr` detects when an operation fails due to a blocked or hidden element.
- [x] It uses an LLM-assisted "Heal Mode" to hypothesize a bypass (e.g., a CSS selector to remove).
- [x] It tests the bypass dynamically in the browser.
- [x] If successful, it records the new rule in `~/.ibr/augmentations.json`.
- [x] It uses `fit` TS SDK to manage the iterative healing session and rewards.

## Scenarios

### Autonomous Paywall Bypass
**Given** a page with a new, unrecorded paywall modal that blocks clicks.
**When** `ibr` attempts a click and fails.
**Then** it should enter "Heal Mode", identify the modal's CSS selector, remove it, and successfully complete the click.
**And** it should save the bypass rule for future use.

## E2E Coverage

**Existing E2E coverage** — [healing.test.js](../../test/e2e/healing.test.js),
`should trigger Heal Mode and use learnings for intuition` (fake AI driven by
the `healing-intuition-test` cassette; `paywall-a` then `paywall-b`):

- Detects blocked-element failure → enters Heal Mode: the click on `#target`
  is intercepted by the full-screen `.modal`, and the test asserts
  `HealingService: initiating Heal Mode` fires. Covers criterion 1.
- LLM-assisted hypothesis: the cassette supplies the healer's CSS-selector
  bypass, and the test asserts `HealingService: found successful fix`. Covers
  criterion 2.
- Dynamic in-browser bypass: `HealingScorer` removes the selector live and
  verifies the target is visible/enabled, then the original action is retried
  against the healed page — asserted via `Retrying action after successful heal`
  and a `code === 0` completion. Covers criterion 3.
- Persistence: the healed rule is written into the augmentations store
  (asserted: `auto-fix-paywall-a` present in `IBR_AUGMENTATIONS_FILE`), and a
  learning is indexed by structural signature in `IBR_LEARNINGS_FILE`. Site B
  (`paywall-b`) then heals guided by that learning. Covers criterion 4 and the
  scenario's "save the bypass rule for future use".
- fit SDK loop: reaching `found successful fix` requires the `@hop-top/fit`
  `Session` reward loop (`rewardThreshold: 1.0`) to accept a scored hypothesis;
  the successful heal exercises that path end-to-end. Covers criterion 5
  (indirectly — the flow only completes through the fit Session).

**Expected E2E coverage for full criteria** (not yet asserted):

- Direct assertion of the fit `Session` reward/step semantics (multi-turn,
  `maxSteps`) rather than the indirect success-path proof above.
- The `switch_provider` heal branch (infra switch on block) is unexercised by
  this test; add a case that drives the cloud-provider switch hypothesis.
