# 001 - Basic Navigation & Action

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Navigate to a URL and perform click/fill/type/press actions described in
natural language.

## Stories

- As a CLI user, I pass a `url` + `instructions` block so idx opens the page
  and executes each action in order.
- As a CLI user, I describe elements by visible text or role so idx locates
  them without selectors.
- As a CLI user, I use `press KeyName` to trigger keyboard events (Enter,
  Escape, Tab, etc.).

## Acceptance Criteria

- `idx` accepts YAML-like prompt string as CLI argument.
- Navigates to `url` before executing instructions.
- Executes `click`, `fill`, `type`, `press` in sequence.
- Times out gracefully with an actionable error if element not found.
