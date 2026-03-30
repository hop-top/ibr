# 030 - Structured Success Output Contract

**Persona:** [AI Coding Assistant](../personas/ai-coding-assistant.md),
[Automated Workflow](../personas/automated-workflow.md),
[Integrator](../personas/integrator.md)

## Goal

Receive a stable machine-readable success payload from the CLI so successful
runs can be consumed without scraping human-oriented logs.

## Stories

- As an AI coding assistant, I read a stable JSON success payload from stdout.
- As an automated workflow, I consume success output programmatically while
  leaving human logs on stderr.
- As an integrator, I rely on the CLI and daemon success payloads having the
  same top-level structure.

## Acceptance Criteria

- Successful CLI execution writes a JSON object to stdout.
- The success payload includes extracted data and token usage information.
- Human-readable logging stays off the success payload channel.
- Runs with no extracts still return a stable empty-data shape rather than
  ad-hoc text.
- Stateless CLI and daemon mode share the same success schema.

## E2E Coverage

**Existing E2E coverage**

- [cli-daemon.test.js](../../test/e2e/cli-daemon.test.js) — partial: daemon
  responses already return JSON payloads with extracts and token usage.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-success-output.test.js` —
  should verify the normal CLI success payload shape and stderr/stdout
  separation.
