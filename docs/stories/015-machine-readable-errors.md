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
