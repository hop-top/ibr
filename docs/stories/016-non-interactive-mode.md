# 016 - Non-Interactive Mode

**Persona:** [AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

ibr never blocks waiting for user input; all configuration supplied via env
vars or prompt string, not interactive prompts.

## Stories

- As an AI coding assistant, ibr never opens a REPL or readline prompt;
  missing config fails fast with a structured error.
- As an AI coding assistant, I can pipe a prompt via stdin as an alternative
  to passing it as a CLI argument.

## Acceptance Criteria

- No interactive prompts at any point during execution.
- Missing required config (API key) → immediate exit, non-zero code, JSON error.
- Prompt accepted from stdin when no CLI argument provided (`ibr < prompt.yaml`).

## E2E Coverage

**Existing E2E coverage**

- [cli-non-interactive.test.js](../../test/e2e/cli-non-interactive.test.js) —
  partial: covers stdin prompt input, missing-key failure without a TTY, and
  absence of readline prompt characters.

**Expected E2E coverage for full criteria**

- Extend [cli-non-interactive.test.js](../../test/e2e/cli-non-interactive.test.js)
  to verify the no-prompt/no-stdin failure path and CLI-argument precedence
  over piped stdin content.
