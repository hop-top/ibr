# 031 - Cache Reuse Across Repeated Runs

**Persona:** [Integrator](../personas/integrator.md),
[Automated Workflow](../personas/automated-workflow.md)

## Goal

Reduce repeated AI work on similar runs by reusing cached find/action schemas
when the page structure is still compatible.

## Stories

- As an automated workflow, repeated runs against the same page reuse cached
  schemas so execution is cheaper and faster.
- As an integrator, I disable caching when I need fully fresh AI decisions.
- As an integrator, failed cache entries eventually invalidate themselves.

## Acceptance Criteria

- Cache is enabled by default and can be disabled with `CACHE_ENABLED=false`.
- Repeated runs reuse cached find/action schemas when URL, prompt, and DOM
  compatibility match.
- Cache keys normalize URL and prompt consistently.
- Cache failures increment failure counters and invalidate entries at the
  configured threshold.
- Cache location follows explicit `CACHE_DIR`, XDG cache, or OS defaults.

## E2E Coverage

**Existing E2E coverage**

- None today. Cache behavior is covered by integration and unit tests.

**Expected E2E coverage for full criteria**

- `test/e2e/cli-cache-reuse.test.js` — should
  verify cache hits across repeated runs, opt-out behavior, and invalidation on
  repeated failures.
