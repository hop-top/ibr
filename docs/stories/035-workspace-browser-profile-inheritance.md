# 035 - Workspace Browser Profile Inheritance

**Persona:** [Workspace Operator](../personas/workspace-operator.md)

## Goal

Reuse workspace-level browser profile metadata so authenticated browser context
can be inherited automatically in workspace-native runs.

## Stories

- As a workspace operator, I set a workspace `browser_profile` once and let
  ibr reuse it automatically.
- As a workspace operator, I still override the inherited profile explicitly
  with `--cookies` when needed.

## Acceptance Criteria

- When no `--cookies` flag is supplied, ibr checks workspace metadata for
  `browser_profile`.
- When `browser_profile` is present, ibr uses it for cookie import.
- An explicit `--cookies` flag overrides workspace metadata.
- Missing or invalid workspace metadata is non-fatal and does not block the run.

## E2E Coverage

**Existing E2E coverage**

- None today. Current WSM E2E coverage does not assert browser profile
  inheritance.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-wsm-browser-profile.test.js`
  — should verify metadata-driven profile selection and explicit `--cookies`
  override behavior.
