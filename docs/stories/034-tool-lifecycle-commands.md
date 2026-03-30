# 034 - Tool Lifecycle Commands

**Persona:** [CLI User](../personas/cli-user.md),
[Maintainer](../personas/maintainer.md)

## Goal

Manage the installed tool itself through dedicated lifecycle commands without
invoking browser or AI execution paths.

## Stories

- As a CLI user, I run `ibr version` to inspect the installed version.
- As a CLI user, I run `ibr upgrade` to check for or install available updates.
- As a maintainer, I use `ibr upgrade preamble` to emit the agent-facing
  upgrade hint without launching the runtime.

## Acceptance Criteria

- `ibr version` prints a human-readable version string.
- `ibr version --short` prints just the version.
- `ibr version --json` prints JSON including version and runtime metadata.
- `ibr upgrade` routes into the upgrade flow without requiring a prompt.
- `ibr upgrade preamble` writes the preamble fragment without launching browser
  or AI setup.

## E2E Coverage

**Existing E2E coverage**

- [cli-exit-codes.test.js](../../test/e2e/cli-exit-codes.test.js) — partial:
  proves one subcommand (`snap`) bypasses AI-key validation and standard task
  routing.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-lifecycle-commands.test.js`
  — should verify `version`, `version --short`, `version --json`, and upgrade
  command routing without browser or AI startup.
