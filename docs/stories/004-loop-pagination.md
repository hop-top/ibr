# 004 - Loop / Paginated Scraping

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Repeat a block of actions until a condition fails; enables scraping paginated
or lazy-loaded content without manual iteration.

## Stories

- As a CLI user, I use a `repeatedly:` block to keep clicking "load more"
  and extracting items until the button disappears.
- As a CLI user, loop iterations stop automatically when an `if found`
  condition inside the block is no longer met.
- As a CLI user, I am protected from infinite loops by a safety cap.

## Acceptance Criteria

- `repeatedly:` block reruns child instructions until an `if found` action
  finds no element (loop-exit signal).
- Hard iteration cap (100) prevents runaway loops.
- Extracted data accumulates across iterations.
- Cap reached: ibr logs warning and continues to result output.
