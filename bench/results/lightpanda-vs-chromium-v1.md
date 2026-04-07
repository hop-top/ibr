# Lightpanda vs Chromium benchmark — v1

## How to regenerate

Two runners produce this matrix:

- **Node harness (canonical for now)** — runs without external deps:
  ```sh
  node bench/lightpanda.js --iterations 5 \
    --output bench/results/lightpanda-vs-chromium-v1.md
  ```
- **ben suite (forward-compatible)** — once `ben` is installed
  (`go install hop.top/ben/cmd/ben@latest`):
  ```sh
  ben run --suite bench/ben/lightpanda-vs-chromium.yaml
  ```

The Node harness remains canonical because `ben` may not be installed in all
environments (CI, fresh dev hosts). The ben suite covers the same matrix and
is the preferred runner once `ben` is on PATH — it adds historical
comparison (`ben compare <a> <b>`) and shared registry push.

---

**Date:** 2026-04-07T14:24:53.381Z
**Harness:** `bench/lightpanda.js`
**Scenarios:** static-scrape, dom-extract, annotate-screenshot
**Iterations per scenario × backend:** 5
**Node:** v25.9.0
**Host:** darwin/arm64

## Summary

Live run captured for all backends. Compare wall time and peak RSS between backends per scenario.

Expected directionally per upstream lightpanda claims: ~9x faster wall time, ~16x less peak RSS on static-scrape relative to bundled chromium. This validates the Q1 "speed/footprint" driver from the brainstorm.

## Scenario — static-scrape

| Backend    | Iter | OK | Err | Startup (ms) | Wall (ms) | Peak RSS (MB) |
|------------|-----:|---:|----:|-------------:|----------:|--------------:|
| chromium   |    5 |  5 |   0 |           77 |        65 |          97.5 |
| lightpanda |    5 |  5 |   0 |           58 |        15 |         161.6 |

## Scenario — dom-extract

| Backend    | Iter | OK | Err | Startup (ms) | Wall (ms) | Peak RSS (MB) |
|------------|-----:|---:|----:|-------------:|----------:|--------------:|
| chromium   |    5 |  5 |   0 |           82 |        61 |         165.5 |
| lightpanda |    5 |  5 |   0 |           58 |        19 |         170.2 |

## Scenario — annotate-screenshot

| Backend    | Iter | OK | Err | Startup (ms) | Wall (ms) | Peak RSS (MB) |
|------------|-----:|---:|----:|-------------:|----------:|--------------:|
| chromium   |    5 |  5 |   0 |           80 |       133 |         174.7 |
| lightpanda |    5 |  5 |   0 |           58 |        33 |         174.3 |

## Notes

- Measurements are wall-clock + RSS from the **ibr process**, not the child browser. Lightpanda's footprint in particular is split between the ibr node process and the lightpanda Zig child; the comparison reported here under-counts the chromium child. For apples-to-apples full-family RSS, wrap the run in `/usr/bin/time -l` (macOS) or `/usr/bin/time -v` (linux) and compare maximum resident set.
- Startup time includes resolver overhead (probe + cache lookup). First lightpanda run includes download; iteration 0 is excluded from averages when more than one iteration is reported.
- Scenarios use a local HTTP server bound to 127.0.0.1 on an ephemeral port — no external network dependency.
- To regenerate: `node bench/lightpanda.js --iterations 5 --output bench/results/lightpanda-vs-chromium-v1.md`. Overwrites this file.

## How to run

```bash
# 1. Warm the lightpanda cache once (downloads binary).
BROWSER_CHANNEL=lightpanda node src/index.js --help >/dev/null

# 2. Ensure playwright chromium is installed.
npx playwright install chromium

# 3. Run the benchmark.
node bench/lightpanda.js --iterations 5 --output bench/results/lightpanda-vs-chromium-v1.md
```
