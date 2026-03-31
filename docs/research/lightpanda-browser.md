# LightPanda Browser — Research & Assessment

**Author:** $USER
**Date:** 2026-03-31
**Task:** T-0035
**Ref:** https://github.com/lightpanda-io/browser

---

## Summary

LightPanda: headless browser built from scratch in Zig. Not a Chromium fork.
Targets AI agents, scrapers, automation pipelines. Exposes CDP; compatible
with Playwright/Puppeteer at protocol level. Beta status; 26k GitHub stars;
AGPL-3.0 licensed.

---

## Relevance Score: 3 / 5

Relevant for ibr's performance goals and scraping use cases, but not a
drop-in backend today. CDP compatibility caveat is a real blocker for
production use with ibr's Playwright-dependent operations.

---

## Key Findings

### Performance

- 11x faster execution vs Chrome (2.3s vs 25.2s; 100-page Puppeteer bench)
- 9x less memory vs Chrome (24MB vs 207MB peak; AWS EC2 m5.large)
- Older README claims 16x memory reduction on 933-page test set
- Instant startup (no Chromium cold-start overhead)
- Skips CSS layout, image decode, GPU compositing — pure content fetch

### API Surface

- Implements Chrome DevTools Protocol (CDP)
- Playwright and Puppeteer connect via CDP — theoretically compatible
- **Critical caveat**: Playwright's JS shim detects browser capabilities
  and switches code paths. New LightPanda Web API impls can silently break
  scripts by triggering untested Playwright branches
- CORS not yet implemented (issue #2015)
- Web API coverage: partial; marked WIP

### Use Cases: LightPanda Excels

- High-throughput scraping (10x+ concurrency at same memory budget)
- Simple DOM extraction / data harvest with minimal JS interaction
- AI agent pipelines: fast page-to-text for LLM context
- Cost-sensitive cloud automation (smaller instances, lower bills)
- Multi-tenant SaaS: multi-client CDP connections per single process

### Use Cases: Playwright / Chromium Still Better

- Complex JS-heavy SPAs (React, Vue, Angular apps)
- Login flows, form submission, multi-step auth
- Visual verification / screenshot diffing
- Sites with advanced anti-bot (fingerprinting, canvas checks)
- Any site relying on unimplemented Web APIs

### Architecture Patterns Worth Borrowing

1. **Benchmark methodology**: 100-page batch fetch on controlled EC2 infra;
   memory + time both measured; reproducible via Docker. ibr has no benchmark
   suite yet — this approach is directly adoptable.
2. **Multi-client single-process CDP server**: LightPanda serves N clients
   from one process. ibr daemon mode is single-client today — same pattern
   is worth exploring for parallel `ibr` invocations.
3. **Minimal footprint philosophy**: stripping rendering-only browser work
   (CSS, GPU, images) mirrors ibr's own DOM simplification (DomSimplifier.js).
   Validates ibr's direction.
4. **robots.txt compliance flag** (`--obey-robots`): clean opt-in for
   responsible automation — worth adding to ibr.

### Feasibility as Optional ibr Backend

- **Not feasible today**: CORS gap + Playwright shim instability risk
- **6-12 month horizon**: if CORS lands + Playwright compat improves,
  a `BROWSER_ENGINE=lightpanda` env flag could route ibr's CDP connection
- **Wrapper approach**: ibr already abstracts browser via `getBrowserConfig()`;
  adding a LightPanda channel would be contained to that layer + daemon.js
- **Gate condition**: pass ibr's e2e test suite against LightPanda CDP before
  enabling

---

## Recommendation

Monitor LightPanda as backend. Act on learnings now:

**Actionable immediately:**
- Create ibr benchmark suite using same methodology (100-page batch, memory +
  time, reproducible via Docker) — no dependency on LightPanda to do this
- Add `--obey-robots` flag to ibr CLI for responsible automation opt-in
- Explore multi-client daemon: ibr daemon is single-client today; same CDP
  multi-tenant pattern applies for parallel invocations

**LightPanda backend — blocked on:**
- CORS gap (issue #2015) — hard blocker for most real sites
- Playwright shim instability — silent breakage risk
- Re-evaluate when CORS lands; gate: ibr full e2e suite passes against
  LightPanda CDP endpoint

**Watch:** issues #2015, Playwright compat tracker, AGPL licensing (cloud use)

---

## Links

- Repo: https://github.com/lightpanda-io/browser
- Site: https://lightpanda.io
- License: AGPL-3.0 (cloud use requires license review)
- Install: `curl -fsSL https://pkg.lightpanda.io/install.sh | bash`
