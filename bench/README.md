# ibr Benchmark Suite

Measures wall time + peak memory for batch page fetches via `ibr snap`.
Inspired by LightPanda's methodology: N-page batch, reproducible via Docker,
results in JSON for cross-run comparison.

## Quick start (local)

```sh
# 3-URL smoke test
node bench/run.js --count 3

# Full 100-URL run
node bench/run.js

# Custom count + concurrency
node bench/run.js --count 50 --concurrency 4

# Explicit output path
node bench/run.js --count 10 --output /tmp/bench-10.json
```

Results land in `bench/results/<timestamp>.json`.

## View report

```sh
# Latest result
node bench/report.js

# Specific file
node bench/report.js bench/results/2025-01-01T00-00-00.json
```

## justfile targets

```sh
just bench          # node bench/run.js (pass args via just bench -- --count 10)
just bench-report   # node bench/report.js
```

## Docker (reproducible)

```sh
# Build + run full 100-URL bench; results copied back to bench/results/
./bench/docker-run.sh

# With custom count
./bench/docker-run.sh --count 20 --concurrency 2
```

### Manual Docker steps

```sh
docker build -f bench/Dockerfile -t ibr-bench .
docker run --rm \
  -v "$(pwd)/bench/results:/app/bench/results" \
  ibr-bench --count 100
```

## Result schema

```jsonc
{
  "meta": {
    "date": "ISO-8601",
    "node": "v22.x",
    "platform": "linux/x64",
    "count": 100,
    "concurrency": 1
  },
  "results": [
    {
      "url": "https://example.com",
      "durationMs": 1234,
      "memoryMb": 45.2,    // 0 if unavailable
      "exitCode": 0,
      "error": "..."       // only on failure
    }
  ],
  "summary": {
    "totalMs": 120000,
    "avgMs": 1200,
    "p50Ms": 1100,
    "p95Ms": 3400,
    "peakMemoryMb": 88.0,
    "successRate": 97.0
  }
}
```

## URL list

`bench/pages.js` — 100 public URLs across:
- Static/minimal: example.com variants, httpbin, neverssl
- News (SSR): Hacker News, BBC, Reuters, AP
- Docs: MDN, Node.js, Vitest, Playwright, esbuild
- Encyclopedia: Wikipedia articles
- JS-heavy SPAs: GitHub repo pages, Dev.to, Stack Overflow
- Package registry: npm package pages

No auth-walled or consistently rate-limited pages.

## Notes

- `ibr snap` is used (no AI provider needed — DOM dump only).
- `BROWSER_HEADLESS=true` is forced in Docker and recommended locally.
- Memory reporting requires Node.js `child_process.resourceUsage()` (v16+);
  shows `n/a` on unsupported platforms.
- Each URL runs in its own subprocess — no browser state shared between runs.
