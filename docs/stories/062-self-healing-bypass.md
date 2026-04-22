# Story: Self-Healing Bypass

As a user, I want `ibr` to autonomously identify and bypass page obstructions (like new paywall modals) that weren't previously recorded, and save the solution for future runs.

## Acceptance Criteria

- [ ] `ibr` detects when an operation fails due to a blocked or hidden element.
- [ ] It uses an LLM-assisted "Heal Mode" to hypothesize a bypass (e.g., a CSS selector to remove).
- [ ] It tests the bypass dynamically in the browser.
- [ ] If successful, it records the new rule in `~/.ibr/augmentations.json`.
- [ ] It uses `fit` TS SDK to manage the iterative healing session and rewards.

## Scenarios

### Autonomous Paywall Bypass
**Given** a page with a new, unrecorded paywall modal that blocks clicks.
**When** `ibr` attempts a click and fails.
**Then** it should enter "Heal Mode", identify the modal's CSS selector, remove it, and successfully complete the click.
**And** it should save the bypass rule for future use.
