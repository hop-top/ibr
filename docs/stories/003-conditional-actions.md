# 003 - Conditional Actions

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Skip actions when an element is absent, preventing failures on optional UI
elements (banners, modals, cookie notices).

## Stories

- As a CLI user, I suffix any action with `if found` so ibr skips it when
  the element is not present rather than erroring.
- As a CLI user, I handle cookie banners with `click 'Accept' if found`
  without branching logic.

## Acceptance Criteria

- `if found` suffix makes the action a no-op when element is absent.
- No error or warning emitted for skipped `if found` actions.
- Action executes normally when element is present.
