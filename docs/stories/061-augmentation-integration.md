# Story: Augmentation Integration

As a user, I want `ibr` to automatically apply domain-specific augmentations (like removing paywalls or silencing noise) based on the target URL, so that the AI handles complex pages more reliably and with fewer tokens.

## Acceptance Criteria

- [ ] `ibr` matches the target URL against regex patterns in `~/.ibr/augmentations.json`.
- [ ] If a match is found, specified DOM mutations (remove, isolate, addClass) are applied before taking a snapshot.
- [ ] Custom JavaScript scripts (`evaluateBeforeSnapshot`) are executed in the browser context.
- [ ] The `--raw` or `--ignore-augmentations` flag bypasses all augmentations.
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
