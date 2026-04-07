# bench/ben — ben suite definitions

Forward-compatible [ben](https://hop.top/ben) suite specs for the ibr
benchmark matrix. Complements the standalone Node harness in
`bench/lightpanda.js` — same scenarios, different runner.

## When to use which

| Tool                | Use when                                                                |
|---------------------|-------------------------------------------------------------------------|
| `bench/lightpanda.js` (Node harness) | Tight feedback loop, no ben install, offline dev, full markdown report |
| `ben run --suite ...` (this dir)     | Cross-run comparison, historical query, shared registry push, CI gate  |

The Node harness is the **canonical** runner today because `ben` may not be
installed in every environment. Once `ben` is on CI / dev paths, the suite
file here becomes the source of truth and the harness becomes its
implementation detail.

## Install ben

```sh
go install hop.top/ben/cmd/ben@latest
```

## Run the suite

```sh
# from the repo root (cwd matters — cmd uses relative `node bench/...`)
ben run --suite bench/ben/lightpanda-vs-chromium.yaml
```

## Compare two historical runs

```sh
ben query --suite lightpanda-vs-chromium --last 10
ben compare <run-id-a> <run-id-b>
```

## What it measures

Each candidate is one cell of the `{backend} × {scenario}` matrix
(6 candidates total: chromium/lightpanda × static-scrape/dom-extract/
annotate-screenshot). The `cli` adapter captures `latency_ms`, `exit_code`,
and `output_size` per candidate; ben ranks by `latency_ms` (lowest wins).

For the full ibr-process startup / wall / RSS breakdown, use the Node harness
directly — it produces a markdown report with per-iteration stats and
compat-gap diagnostics that the cli adapter does not surface.
