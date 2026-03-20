# 021 - High-Precision AI-Actionable Error Messages

**Persona:** [AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Every error thrown by idx includes enough context for an AI agent to
self-correct without consulting docs: what failed, the bad value or
missing field, and a concrete next step.

## Stories

- As an AI coding assistant, when an element cannot be resolved I receive
  the descriptor that failed plus `idx snap <url> -i` to inspect alternatives.
- As an AI coding assistant, when AI output cannot be parsed I receive the
  parse strategy that failed plus `AI_TEMPERATURE=0` to reduce variability.
- As an AI coding assistant, when a config value is invalid I receive the
  bad value and the accepted range or set of values.
- As an AI coding assistant, when a CLI flag is missing its argument I
  receive a Usage line and an Example in the error string.

## Acceptance Criteria

- `Unable to resolve element descriptor` errors include:
  - The serialised descriptor.
  - `idx snap <url> -i` hint.
  - `@refs` mention for ARIA-mode element targeting.
- `Failed to execute action` errors include:
  - Action type + element locator description.
  - `hidden, disabled, or covered` diagnosis hint.
  - `idx snap <url> -i` hint.
- `AI_TEMPERATURE` validation errors include `got: <value>` and
  `AI_TEMPERATURE=0 for deterministic outputs`.
- `--cookies` missing-value error includes Usage + Example + supported
  browser list.
- `snap` missing-URL error includes Usage + Example.
- `-d` / `-s` flag errors include argument example and what the flag controls.
- `BAML parser: Unable to extract JSON` error names all strategies tried.
- `AI response missing usage information` error mentions API version mismatch.
- All new error strings are covered by unit tests asserting on message content.
