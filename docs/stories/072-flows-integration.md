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

## E2E Coverage

**Status: Expected — not yet implemented (draft / `paper`).**

No flow e2e exists in this repo, and none should be faked. Reading the ibr
source confirms the ibr-side surface this story needs is **not implemented**:

- **No file-output surface.** ibr emits extraction to stdout/stderr only
  (`logger.info('Extracted data …')` in [src/index.js](../../src/index.js)).
  There is no `--output`/`-o` flag and no `output-path` / `output-format`
  handling in the flag parser or `commands/` — the story's
  `output-path` + `output-format: markdown` (write a consumable file for the
  next step via `${capture.output.path}`) has nothing to wire to.
- **No `cookies-from: profile:<id>`.** ibr's `--cookies` accepts a browser
  name only (chrome/brave/edge/arc); there is no aps-secret-store
  `profile:<id>` resolution.
- **The runner is tlc-side, not ibr-side.** Per this story's own
  Implementation Notes ("Runner: tlc flow spawns `ibr` subprocess") and its
  `## Tests` block, the flow-step integration lives in **tlc's flow engine**
  (Go: `tests/e2e/flow_ibr/*.go`, `internal/runner/ibr_test.go`) invoking ibr
  as a plain CLI subprocess. ibr's only obligation is a deterministic exit
  code (which it has, story 017) plus a consumable output contract (a file
  path or a stable stdout format) — and the **file-path half does not exist
  yet**.

**What ibr already provides (partial building blocks)**

- Deterministic exit codes (story [017](017-exit-code-contract.md)).
- Cookie import from a browser via `--cookies` (browser passthrough half of
  `cookies-from: browser:<…>`).
- `--daemon` for warm invocations.

**Expected E2E coverage once implemented**

- An ibr `--output <path> --output-format markdown` (or equivalent) surface
  that writes extraction to a file, VCR/cassette-backed per
  [cli-tool-vcr.test.js](../../test/e2e/cli-tool-vcr.test.js) conventions
  (no live network), asserting the file is populated and its
  `{ path, format, exit_code }` shape.
- tlc-side flow-runner tests (the Go tests listed under `## Tests`) that spawn
  ibr as a step and resolve `${capture.output.path}` downstream — these belong
  in the tlc repo, not here.

A follow-up task tracks implementing the ibr-side output-file surface and its
cassette-backed test.
