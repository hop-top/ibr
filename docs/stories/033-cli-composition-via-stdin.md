# 033 - CLI Composition Via stdin

**Persona:** [CLI User](../personas/cli-user.md),
[Automated Workflow](../personas/automated-workflow.md)

## Goal

Compose ibr cleanly in shell pipelines by piping prompt text into stdin instead
of always passing a long multiline CLI argument.

## Stories

- As a CLI user, I pipe a multiline prompt into ibr when shell quoting would be
  awkward.
- As an automated workflow, I generate a prompt upstream and feed it directly
  into ibr over stdin.

## Acceptance Criteria

- When no positional prompt argument is provided, ibr reads a prompt from stdin.
- Multiline stdin prompts are accepted intact.
- When both argv and stdin are present, the positional prompt argument wins.
- When neither argv nor stdin provides a prompt, ibr fails fast with a
  descriptive config error.

## E2E Coverage

**Existing E2E coverage**

- [cli-non-interactive.test.js](../../test/e2e/cli-non-interactive.test.js) —
  partial: covers prompt input via stdin on a successful run.

**Expected E2E coverage for full criteria**

- Extend [cli-non-interactive.test.js](../../test/e2e/cli-non-interactive.test.js)
  to verify multiline prompts, argv precedence over stdin, and the no-input
  failure path.
