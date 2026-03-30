# 015 - Machine-Readable Errors

**Persona:** [AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Errors emitted in a structured format an AI agent can parse and act on without
screen-scraping free-form text.

## Stories

- As an AI coding assistant, failures produce a JSON error object on stderr
  with `code`, `message`, `step`, and `action` fields.
- As an AI coding assistant, I can distinguish config errors from runtime
  errors by `code` without parsing the message string.

## Acceptance Criteria

- On failure: `{ "error": { "code": string, "message": string, "step"?: number,
  "action"?: string } }` written to stderr as valid JSON.
- Distinct codes for: `CONFIG_ERROR`, `ELEMENT_NOT_FOUND`, `TIMEOUT`,
  `AI_PARSE_ERROR`, `LOOP_CAP_REACHED`.
- stdout remains clean (extracted data only) regardless of errors.

### Extended (T-0013 — high-precision AI-actionable messages)

- Every thrown error includes a next-step hint the AI agent can act on without
  reading docs (e.g. `Run "ibr snap <url> -i"`, `Set AI_TEMPERATURE=0`).
- Config errors name the exact env var and accepted values.
- Element-not-found errors name the descriptor and suggest `ibr snap -i`.
- Parse errors suggest `AI_TEMPERATURE=0` and prompt format corrections.
- Flag errors include Usage + Example in the message string.

## E2E Coverage

**Existing E2E coverage**

- [cli-machine-readable-errors.test.js](../../test/e2e/cli-machine-readable-errors.test.js)
  — partial: covers `AI_PARSE_ERROR`, `ELEMENT_NOT_FOUND`, and stdout hygiene.
- [cli-timeout.test.js](../../test/e2e/cli-timeout.test.js) — partial: covers
  structured `TIMEOUT` serialization.

**Expected E2E coverage for full criteria**

- Extend [cli-machine-readable-errors.test.js](../../test/e2e/cli-machine-readable-errors.test.js)
  to cover `CONFIG_ERROR`, `LOOP_CAP_REACHED`, and stdout cleanliness across
  all error classes.
