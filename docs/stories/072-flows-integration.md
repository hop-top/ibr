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

**Status: Partially implemented.** The ibr-side **output-file surface** now
exists and is unit-tested; `cookies-from: profile:<id>` and the tlc-side
flow-engine stream capture remain **Expected** (out of ibr's scope).

### Existing

- **File-output surface — implemented.** ibr accepts `--output <path>` / `-o
  <path>` and `--output-format json|markdown` (default `json`). After a
  successful run it writes the extraction to the given path (parent dirs
  auto-created) as an **additive** sink — the existing
  `logger.info('Extracted data …')` stdout/stderr line is untouched. An unknown
  `--output-format` fails fast with a `CONFIG_ERROR` (exit 1) before browser
  launch. The step's `{ path, format }` contract is what the next flow step
  resolves via `${capture.output.path}`. Wiring: `parseOutputFlags`,
  `renderExtraction`, `writeExtractionOutput`, and the write call in `run()` —
  all in [src/index.js](../../src/index.js).
  - Markdown rendering choice: the extraction (an array-of-arrays of
    `{ field: value }` objects) is flattened to ordered field/value pairs, each
    rendered as a `## <field>` heading with its value below; multi-line string
    values are preserved verbatim, non-string values are emitted in a fenced
    ```json``` block so the file stays valid markdown.
  - **Test:**
    [test/unit/index.output-file.test.js](../../test/unit/index.output-file.test.js)
    pins flag parsing (`--output`/`-o`, `--output-format`, unknown-format
    `CONFIG_ERROR`, missing-value `CONFIG_ERROR`), both format renderings,
    parent-dir auto-creation, the `{ path, format }` return contract, and the
    additive guarantee (the logger line still present). Runs with no live
    network and no browser (pure exported functions), so it is not
    Chromium-gated.
- Deterministic exit codes (story [017](017-exit-code-contract.md)).
- Cookie import from a browser via `--cookies` (browser passthrough half of
  `cookies-from: browser:<…>`).
- `--daemon` for warm invocations.

### Expected (still not implemented)

- **`cookies-from: profile:<id>`.** ibr's `--cookies` accepts a browser name
  only (chrome/brave/edge/arc); there is no aps-secret-store `profile:<id>`
  resolution. That is an aps/tlc integration, out of ibr's scope for this task.
- **tlc-side flow-engine stream capture.** Per this story's own Implementation
  Notes ("Runner: tlc flow spawns `ibr` subprocess") and its `## Tests` block,
  the flow-step integration lives in **tlc's flow engine** (Go:
  `tests/e2e/flow_ibr/*.go`, `internal/runner/ibr_test.go`) invoking ibr as a
  plain CLI subprocess and capturing stdout/stderr under
  `runs/<run-id>/steps/<step-id>/`. ibr's obligations — a deterministic exit
  code (story 017) and a consumable output-file contract — are now both met;
  the runner and the `${capture.output.path}` downstream resolution belong in
  the tlc repo, not here.
