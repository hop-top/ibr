# ADR 001 — Multi-Client Daemon: Context Pool

**Status:** Accepted
**Date:** 2026-03-31
**Author:** $USER
**Task:** T-0054

---

## Task list

- [x] ADR written
- [x] `ContextPool` class implemented (`src/server/ContextPool.js`)
- [x] `src/server.js` updated — pool-aware `handleRequest`
- [x] `IBR_DAEMON_MAX_CLIENTS` env var wired
- [x] Unit tests: `test/unit/ContextPool.test.js`

---

## Context

Current daemon (`src/server.js` + `src/daemon.js`) is single-client.

Single-client model:
- One `BrowserContext` + one `Page` created at startup
- One global `Operations` instance reused across requests
- Requests processed serially; second `ibr` invocation blocks on first
- State reset between calls (extracts, tokenUsage, executionIndex)
  via in-place mutation after each request

LightPanda's multi-client CDP pattern: one browser process → N isolated
contexts → N concurrent client connections. Each context has isolated cookies,
localStorage, sessionStorage — full browser-partition per tenant.

---

## Decision drivers

- Parallel `ibr` invocations (CI pipelines, scripted workflows)
- Cookie/storage isolation between concurrent tasks (security, correctness)
- No breaking change to single-client callers
- Minimal new surface area (one env var, one new class)

---

## Options considered

### A — Shared BrowserContext, one Page per client

- Single context: cookies shared across all clients
- Each client gets own `Page`
- Simpler resource model; lower memory
- **Rejected**: cookies/localStorage leak between clients; violates isolation

### B — Isolated BrowserContext per client (chosen)

- One `BrowserContext` per in-flight request
- Each context: own cookies, own localStorage, own network state
- Context created on checkout; closed on checkin
- `Operations` instance created fresh per context (no shared mutable state)
- Max concurrency: `IBR_DAEMON_MAX_CLIENTS` (default 3)
- Overflow: queue with per-waiter timeout (30 s default)

### C — Separate browser process per client

- Maximum isolation; highest resource cost
- Startup latency unacceptable for interactive use
- **Rejected**: defeats purpose of a warm daemon

---

## Decision

**Option B.** `ContextPool` manages a pool of `BrowserContext` slots.

Architecture:
```
browser (1)
  └── ContextPool
        ├── slot[0]: BrowserContext + page  ← client A
        ├── slot[1]: BrowserContext + page  ← client B
        └── slot[N-1]: ...                  ← queue if all busy
```

See diagram: [001-multi-client-daemon/context-pool-v1.mmd](001-multi-client-daemon/context-pool-v1.mmd)

Key invariants:
- Context created lazily on first checkout, closed on checkin
- Fresh `Operations` instance per checkout — no shared state
- `IBR_DAEMON_MAX_CLIENTS=1` → behaves identically to original
- Queue timeout configurable via `IBR_DAEMON_QUEUE_TIMEOUT_MS` (default 30 000)

---

## Implementation notes

`src/server/ContextPool.js` — new file, exported class:
- `constructor(browser, opts)` — `maxClients`, `queueTimeoutMs`
- `checkout()` → `Promise<{context, page, ops}>` — blocks if at capacity
- `checkin(slot)` — closes context; wakes next queued waiter
- `drain()` — graceful shutdown; closes all contexts

`src/server.js` changes:
- Remove module-level `context`, `page`, `operations` singletons
- Create `ContextPool` in `main()`; pass to `handleRequest` via closure
- `handleRequest` calls `pool.checkout()` / `pool.checkin(slot)` in try/finally
- `shutdown()` calls `pool.drain()`
- `getOperationOptions()` called once at startup (no change)
- `aiProvider` created once at startup (no change; stateless)

`src/daemon.js` — no changes required (client side; unaware of pool)

---

## Consequences

**Positive:**
- N parallel `ibr` invocations without process overhead
- Full browser isolation per client
- Queueing prevents resource exhaustion on burst

**Negative / risks:**
- Memory: N active contexts × ~50-100 MB each
- Browser process is single point of failure (unchanged from current)
- Context creation adds ~100-300 ms per checkout vs zero for single-context
- Queue timeout silently degrades to error under heavy load — operators
  must tune `IBR_DAEMON_MAX_CLIENTS`

**Unchanged:**
- Auth, state file, idle-check, signal handling
- Client side (`src/daemon.js`) — no changes
- `Operations` public API — no changes
