# Story: 072 - Flows Integration (tlc flow `run.ibr` step)

**ID**: 072
**Persona**: Flow Author / AI Agent
**Priority**: P1
**Task**: T-0116
**Status**: paper
**Author**: jadb

## Narrative

A flow author wants to invoke `ibr` from a `tlc flow` `task` step with cookie/auth
support, and capture extracted output to a file path the next step consumes via
`${<step-id>.output.path}`. Use cases: archived-page price comparison feeds a contract
evaluator; auth-walled research feeds a summariser.

## Flow YAML Shape

```yaml
steps:
  - id: capture
    type: task
    run:
      ibr:
        url: https://example.com/article
        instructions: |
          - extract main article text
          - extract publish date
        cookies-from: profile:noor
        output-path: /tmp/flow-runs/${run-id}/article.md
        output-format: markdown
  - id: summarise
    type: task
    depends_on: [capture]
    run:
      cmd: ["summariser", "--input", "${capture.output.path}"]
```

## Acceptance Scenarios

1. **Given** flow yaml declares `run.ibr` with url + instructions,
   **When** flow executes the step,
   **Then** ibr runs; exit 0; `${capture.output.path}` resolves downstream.

2. **Given** `cookies-from: profile:<id>`,
   **When** step runs,
   **Then** cookies sourced from profile secret store (no hard-coded auth in yaml);
   ibr `--cookies` flag wired from secret.

3. **Given** ibr emits stdout/stderr,
   **When** step runs,
   **Then** both streams capture under `runs/<run-id>/steps/<step-id>/{stdout,stderr}.log`.

4. **Given** `output-path` set and `output-format: markdown`,
   **When** ibr completes,
   **Then** file at output-path populated; step output emits `path` + `format` keys.

5. **Given** ibr returns non-zero exit (page failed, auth expired),
   **When** step runs,
   **Then** step → `failed`; depending steps → `blocked`; run → `failed`.

## Implementation Notes

- Flow yaml shape: `run.ibr: { url, instructions, cookies-from?, output-path,
  output-format?, daemon? }`.
- `cookies-from`: `profile:<id>` (aps secret store) or `browser:<chrome|brave|arc>`
  (passthrough to ibr `--cookies`).
- Runner: tlc flow spawns `ibr` subprocess; captures output to `output-path`.
- Step output: `{ path, format, exit_code }` — composes with story 027 datarefs.

## Tests

### E2E (planned)

- `tests/e2e/flow_ibr/basic_test.go::TestIBR_BasicCapture`
- `tests/e2e/flow_ibr/auth_test.go::TestIBR_CookiesFromProfile`
- `tests/e2e/flow_ibr/output_test.go::TestIBR_OutputPathPopulated`
- `tests/e2e/flow_ibr/failure_test.go::TestIBR_FailurePropagatesToFlow`

### Unit (planned)

- `internal/runner/ibr_test.go` — yaml parser, cookies resolver, output capture,
  exit-code propagation.

## Dependencies

- Builds on: tlc 020-flow-execution, tlc 027-flow-datarefs.
- Composes with: aps 053-nadia-ea-capabilities (cookies-from profile capability check).
- Reuses ibr core: `ibr "<prompt>"`, `--cookies`, `--daemon`, snap modes.
