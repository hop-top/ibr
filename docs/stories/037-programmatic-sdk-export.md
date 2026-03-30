# 037 - Programmatic SDK Export

**Persona:** [Integrator](../personas/integrator.md)

## Goal

Expose a stable package-root SDK entrypoint so integrators can use ibr as a
library instead of shelling out to the CLI.

## Stories

- As an integrator, I import `ibr` from the package root and invoke it directly.
- As an integrator, the SDK path does not call `process.exit()` or write
  user-facing logs unexpectedly.

## Acceptance Criteria

- Package root exports a callable `ibr` function.
- The SDK entrypoint accepts prompt input and runtime options without relying on
  `process.argv`.
- The SDK path resolves or rejects Promises rather than terminating the process.
- SDK execution can be tested independently of the CLI entrypoint.

## E2E Coverage

**Existing E2E coverage**

- None today.

**Expected E2E coverage for full criteria**

- `test/e2e/sdk-export.test.js` — should verify
  package-root importability and successful invocation without subprocess use.
