# 032 - OpenAI-Compatible Gateway Support

**Persona:** [Integrator](../personas/integrator.md)

## Goal

Route OpenAI-mode requests through an OpenAI-compatible gateway or proxy
without changing application code.

## Stories

- As an integrator, I set `OPENAI_BASE_URL` to point ibr at an OpenAI-compatible
  endpoint.
- As an integrator, I keep using `AI_PROVIDER=openai` and `AI_MODEL` overrides
  while routing through that endpoint.
- As an integrator, I get the same error behavior I would expect from the
  normal OpenAI path.

## Acceptance Criteria

- `AI_PROVIDER=openai` with `OPENAI_BASE_URL` sends requests to the configured
  base URL.
- `AI_MODEL` continues to override the model name on the routed requests.
- Provider initialization and usage tracking still work through the compatible
  endpoint.
- Missing required configuration still fails with actionable startup errors.

## E2E Coverage

**Existing E2E coverage**

- [cli-provider-selection.test.js](../../test/e2e/cli-provider-selection.test.js)
  — partial: covers execution against a fake OpenAI-compatible endpoint and a
  custom model override.

**Expected E2E coverage for full criteria**

- Extend [cli-provider-selection.test.js](../../test/e2e/cli-provider-selection.test.js)
  to assert gateway routing, preserved error semantics, and config validation
  when `OPENAI_BASE_URL` is set.
