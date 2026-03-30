# 007 - Programmatic API

**Persona:** [Integrator](../personas/integrator.md)

## Goal

Import and invoke ibr from Node.js code without spawning a subprocess.

## Stories

- As an integrator, I `import { ibr } from '@hop/ibr'` and call it with a
  prompt object to drive browser automation from my pipeline.
- As an integrator, I await the result so my script proceeds after ibr
  completes.

## Acceptance Criteria

- Package exports a callable `ibr(prompt)` function.
- Accepts same prompt schema as CLI (url + instructions).
- Returns a Promise resolving to extracted data + token usage summary.
- Rejects with a structured error object on failure.

## E2E Coverage

**Existing E2E coverage**

- None today. The current E2E suite is CLI-oriented.

**Expected E2E coverage for full criteria**

- `test/e2e/sdk-programmatic-api.test.js`
  — should verify package import, invocation, Promise resolution, and failure
  rejection without subprocess usage.
