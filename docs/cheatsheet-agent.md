# ibr Cheatsheet — Agent / Script Invocation

Quick reference for autonomous agents, scripts, and LLMs invoking ibr as a
subprocess or composing tool pipelines. Scannable in 30 seconds.

---

## Invocation Contract

```
1. Build prompt   →  url: + instructions: block (or natural-language string)
2. Run ibr        →  STDOUT = human/console logs + the extraction (winston)
                     STDERR = progress feedback, NDJSON events, structured errors
3. Gate on exit   →  0 = success, non-0 = failure (check before parsing)
4. Parse output   →  the extraction is logged (pretty-printed, ANSI-colored) on
                     STDOUT after "Extracted data:"  — NOT a clean top-of-stdout
                     JSON array. For clean JSON, use daemon mode (see below).
5. Handle errors  →  JSON error object on STDERR: {"error":{"code":"...","message":"..."}}
```

### Stream layout (verified by running the CLI)

| Stream | Carries |
|--------|---------|
| **stdout** | All winston console logs (info + debug), colorized, timestamped. The final extraction is one of those log lines: `... info: Extracted data:` followed by a multi-line pretty-printed JSON payload. |
| **stderr** | Per-instruction progress lines (unless `--quiet`), a `{"event":"browser.resolved",...}` line, the NDJSON event stream (only if `NDJSON_STREAM=true`), and the structured error object on failure. |

> ⚠️ **stdout is not clean JSON in stateless mode.** Log lines carry a timestamp;
> every line (log headers and the JSON body alike) is wrapped in ANSI color
> escapes, and the extraction is pretty-printed across many lines.
> `grep '^\['` / `line.startsWith('[')` will **not** match it (a `\x1b[32m`
> escape precedes the `[`).
> The verbosity is `debug` unless `NODE_ENV=production` (then `info`). There is
> currently **no `LOG_LEVEL` support** — that env var is ignored.
>
> **For a clean machine-readable payload, use daemon mode** — the daemon prints
> exactly `{"extracts":[...],"tokenUsage":{...}}` (2-space JSON) to stdout with no
> log noise. See [Daemon Mode](#daemon-mode-persistent-browser--clean-json).

**DO:** check exit code before trusting output.
**DO:** parse the structured error JSON from stderr on non-zero exit.
**DO:** prefer daemon mode (or `NODE_ENV=production` + a tolerant extractor) when
you need to parse the result programmatically.
**DON'T:** assume stdout is a single clean JSON array in stateless mode.
**DON'T:** suppress stderr — it carries the structured error payload.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Task completed successfully |
| non-0 (`1`) | Any failure (config, AI, browser launch/action, robots, timeout, wait) |

Every failure path exits `1`; discriminate the failure *type* via the
`error.code` field in the stderr JSON object.

A browser launch/acquire failure is guaranteed to write a non-empty structured
error to stderr and exit non-zero **before** the process ends — it can no longer
be a silent 0-byte exit on a piped/backpressured stream.

---

## Structured Error Output (stderr)

On failure, ibr emits one JSON object to stderr (prefixed by a leading newline):

```json
{"error":{"code":"CONFIG_ERROR","message":"No user prompt provided..."}}
{"error":{"code":"AI_PARSE_ERROR","message":"AI model returned an empty response..."}}
{"error":{"code":"RUNTIME_ERROR","message":"...","step":2,"action":"click"}}
{"error":{"code":"ROBOTS_DISALLOWED","message":"Target URL is disallowed by robots.txt..."}}
{"error":{"code":"TIMEOUT","message":"Execution exceeded the global timeout of 60000 ms..."}}
{"error":{"code":"WAIT_FOR_HUMAN_NO_TTY","message":"...stdin is not a TTY..."}}
```

| Error Code | Trigger |
|------------|---------|
| `CONFIG_ERROR` | Missing prompt/URL, invalid flag, bad env var, missing `--param` |
| `AI_PARSE_ERROR` | AI returned unparseable response |
| `RUNTIME_ERROR` | Browser launch/action failed during execution (`step`/`action` when known) |
| `ROBOTS_DISALLOWED` | robots.txt check failed (`--obey-robots` / `OBEY_ROBOTS=true`) |
| `TIMEOUT` | Run exceeded `EXECUTION_TIMEOUT_MS` |
| `WAIT_FOR_HUMAN_NO_TTY` | A "wait for me to …" step hit a non-TTY stdin without `IBR_WAIT_FOR_HUMAN_ALLOW_PIPED=true` |
| `WAIT_FOR_HUMAN_STDIN_CLOSED` | Piped stdin ended (EOF) before the human line arrived |

`step` / `action` fields are present on `error` only when the failing
instruction index/action is known (`RUNTIME_ERROR` from a browser action).

Parse pattern (shell):
```bash
err=$(ibr "..." 2>&1 1>/dev/null)
code=$(echo "$err" | grep -o '"code":"[^"]*"' | head -1 | cut -d'"' -f4)
```

Parse pattern (Node.js):
```javascript
const { stdout, stderr, exitCode } = await execa('ibr', [...args]);
const errLine = stderr.split('\n').find(l => l.startsWith('{"error"'));
const { error } = errLine ? JSON.parse(errLine) : {};
```

---

## Extraction Output (stateless mode, stdout)

On success, the extraction is emitted as a **winston log line** on stdout —
pretty-printed (multi-line, indented) and ANSI-colored, after an
`... info: Extracted data:` header:

```
2026-08-15 12:00:51 info: Task execution completed {"service":"ibr"}
2026-08-15 12:00:51 info: Extracted data:
[
  [
    {
      "verdict": "PAGE_OK"
    }
  ]
] {"service":"ibr"}
```

Notes that break naive parsers:

- The extraction is `ops.extracts` — an **array of per-extract results**. Each
  extract instruction contributes one element, itself the array that instruction
  returned. So a single verdict extract yields `[[{"verdict":"PAGE_OK"}]]`
  (outer = extracts list, inner = that extract's array).
- Lines are ANSI-color-escaped and timestamped. `grep '^\['` /
  `line.startsWith('[')` match **nothing** (a `\x1b[32m` escape precedes the `[`).
- The trailing `{"service":"ibr"}` meta is appended to the log line.

**Recommended: use daemon mode for a clean payload** (next section). If you must
parse stateless stdout, strip ANSI and slice from the `Extracted data:` marker:

```bash
# Strip ANSI, slice the block between the marker and its closing line, drop meta
ibr "..." \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | sed -n '/info: Extracted data:/,/^] {"service":"ibr"}$/p' \
  | sed '1d; s/ {"service":"ibr"}$//' \
  | jq '.'
```

---

## Progress Feedback (stderr, on by default)

Independent of `NDJSON_STREAM`. Every run emits per-top-level-instruction
progress to **stderr** so a blocking run never looks hung. On a **non-TTY**
(the agent/subprocess case) each step is one JSON line, and the run ends with a
`done` line:

```json
{"phase":"run","step":"wait","current":1,"total":2,"percent":50,"message":"for the page to load (2.7s)"}
{"phase":"run","step":"condition","current":2,"total":2,"percent":100,"message":"if the heading ... (7.7s)"}
{"done":true,"message":"task complete (10.3s)"}
```

- `step` is the instruction name (`wait`, `click`, `extract`, `condition`, …).
- `current`/`total` count **top-level** instructions only (nested condition/loop
  bodies do not advance the counter).
- On a TTY, kit renders human lines with a spinner instead of JSON.
- On failure the terminal line is `{"done":true,"message":"task failed (…)"}`.

This is **distinct** from the NDJSON event stream below. Both go to stderr; only
NDJSON is opt-in. So an agent's stderr carries, in order: a `browser.resolved`
line, progress lines (unless `--quiet`), optionally the NDJSON events, and a
`done` line — plus the structured error object if the run fails.

Silence progress with `--quiet` / `-q` (leaves NDJSON events and errors intact):

```bash
ibr --quiet "..."                       # no progress lines on stderr
NDJSON_STREAM=true ibr -q "..."         # NDJSON events only, no progress
```

---

## Verdict Extraction

An instruction that asks ibr to **report a status token** —
`report PAGE_OK if … , or PAGE_FAILED` — yields a structured verdict object
rather than scraped text. In the extracts output that extract's array is
`[{"verdict":"PAGE_OK"}]`, so a lone verdict extract surfaces as
`[[{"verdict":"PAGE_OK"}]]` (see the double-nesting note above). Extra detail
requested alongside the token lands as sibling fields:
`{"verdict":"PAGE_FAILED","error":"..."}`. Gate scripts on `.[][] | .verdict`.

Triggered by a reporting verb (`report`/`return`/`emit`/…) plus a real
UPPER_SNAKE / uppercase status token; ordinary per-row data extractions are not
affected.

---

## Visual Mode & Extract-from-Image

`--mode visual` sends a marked screenshot to the LLM for both element location (model picks a mark) and data extraction directly from pixels. Extract-from-image results land in the same `.extracts` array as text extractions, preserving the existing parse paths. Auto-mode escalates to visual as a **last resort** when aria + dom text find succeeds but the action fails, so scripts using only text extraction need no changes. To use visual explicitly for extraction:

```javascript
const args = ['url: https://example.com', '--mode', 'visual', 'instructions:', '  - extract the price from pixels'];
```

Vision model defaults to `AI_MODEL` unless `VISUAL_AI_MODEL` is set (recommend for stronger vision quality; text mode remains on the cheaper model). Escalation count exposed via progress feedback and NDJSON events if `NDJSON_STREAM=true`.

---

## NDJSON Event Stream (`NDJSON_STREAM=true`)

For real-time event consumption without polling. Events go to **stderr**.

```bash
NDJSON_STREAM=true ibr "..." 2>events.ndjson
```

### Event Schema

`timestamp` is ISO-8601. `status` is `"success"` or `"error"` (an `error`
string field is present on failures).

```json
{"event":"task_start","timestamp":"<iso>","prompt":"https://example.com"}
{"event":"navigation","timestamp":"<iso>","url":"https://example.com","status":"success"}
{"event":"click","timestamp":"<iso>","selector":"<locator desc>","status":"success"}
{"event":"fill","timestamp":"<iso>","selector":"<locator desc>","valueLength":12,"status":"success"}
{"event":"extract","timestamp":"<iso>","field":"title","value":"Page Title","status":"success"}
{"event":"task_end","timestamp":"<iso>","duration_ms":3421,"status":"success"}
{"event":"error","timestamp":"<iso>","instruction":"click","error":"Element not found"}
```

### Event Types

| Event | Meaning |
|-------|---------|
| `task_start` | Execution begins; `prompt` field carries the target URL |
| `navigation` | Page navigation; `url` + `status` (`success`/`error`) |
| `<action>` | The event name IS the action: `click` / `fill` / `type` / `press` / `scroll`; `selector` (locator description) + `status`, `fill` adds `valueLength` |
| `extract` | Extraction step; `field` + `value` + `status` |
| `task_end` | Run complete; `duration_ms` + `status` (`success`/`error`) |
| `error` | Instruction-level failure; `instruction` (type) + `error` |

### Filter by event type

```bash
NDJSON_STREAM=true ibr "..." 2>&1 1>/dev/null \
  | jq -c 'select(.event == "extract")'

# All failures only
  | jq -c 'select(.event == "error" or .status == "error")'
```

---

## Tool Subcommand Output

`ibr tool <name> --param k=v` resolves the YAML into a prompt and runs the **same
stateless flow** — so its result has the same stdout layout: the extraction is a
winston `Extracted data:` log line, not a clean top-of-stdout array. Use the
ANSI-strip slice from [Extraction Output](#extraction-output-stateless-mode-stdout),
or run the daemon.

```bash
# Slice the extracted JSON out of the console log
ibr tool arxiv --param query="LLM agents" \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | sed -n '/info: Extracted data:/,/^] {"service":"ibr"}$/p' \
  | sed '1d; s/ {"service":"ibr"}$//' \
  | jq '.[0][0].title'
```

Missing required param → exit 1 **before** browser launch:
```json
{"error":{"code":"CONFIG_ERROR","message":"Missing required param: query. Pass it with --param query=<value>."}}
```

List available tools (machine-readable):
```bash
ibr tool --list 2>/dev/null
```

### Built-in Tools

| Tool | Required Params | Optional Params |
|------|----------------|-----------------|
| `web-search` | `query` | `count` (5) |
| `web-fetch` | `url` | `selector` |
| `trend-search` | `topic` | `region` (US), `period` (7d) |
| `github-search` | `query` | `type` (repositories), `count` (10) |
| `github-trending` | _(none)_ | `language`, `period` (daily), `count` (10) |
| `github-starred` | `username` | `query`, `count` (10) |
| `context7` | `library`, `question` | `version` |
| `arxiv` | `query` | `max_results` (5), `category` |
| `web-archive` | `url` | `date` (YYYYMMDD) |
| `wikipedia` | `topic` | `section`, `lang` (en) |
| `amazon` | `query` | `max_results` (5), `country` (com) |
| `ebay` | `query` | `max_results` (5), `sold` (false), `country` (com) |
| `npm` | `package` | — |
| `pypi` | `package` | — |
| `producthunt` | `query` | `max_results` (5) |
| `reddit` | `query` | `subreddit`, `sort` (relevance), `max_results` (5) |
| `hackernews` | `query` | `type` (story), `sort` (popularity), `max_results` (10) |
| `yahoo-finance` | `ticker` | — |
| `dockerhub` | `image` | `max_results` (5), `show_tags` (false) |

---

## Invocation Patterns

### Shell subprocess (stateless)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Capture stdout + stderr separately; gate on exit before parsing.
out=$(ibr "url: https://example.com
instructions:
  - extract the h1 heading" 2>/tmp/ibr-err.log) || {
  code=$(grep -o '"code":"[^"]*"' /tmp/ibr-err.log | head -1 | cut -d'"' -f4)
  echo "ibr failed: ${code:-UNKNOWN}" >&2
  exit 1
}

# The extraction is a winston log line — strip ANSI + slice the JSON block.
echo "$out" \
  | sed 's/\x1b\[[0-9;]*m//g' \
  | sed -n '/info: Extracted data:/,/^] {"service":"ibr"}$/p' \
  | sed '1d; s/ {"service":"ibr"}$//' \
  | jq '.[0]'
```

### Node.js subprocess (daemon → structured `{extracts,tokenUsage}`, recommended)

Daemon mode returns the `{"extracts":[...],"tokenUsage":{...}}` object on stdout,
preceded by a single `Starting ibr …` banner log line. Strip ANSI and slice from
the first `{` to EOF, then `JSON.parse`. **Daemon mode takes a direct prompt
only — it does not route the `tool` subcommand** (see Tool pipeline below).

```javascript
import { execa } from 'execa';

const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*m/g, '');
// Daemon stdout = one banner line + a pretty-printed JSON object.
const parseDaemonStdout = (stdout) => {
  const clean = stripAnsi(stdout);
  const start = clean.indexOf('\n{');            // first standalone object
  return JSON.parse(start === -1 ? clean : clean.slice(start + 1));
};

async function runIbr(prompt, env = {}) {
  const { stdout, stderr, exitCode } = await execa(
    'ibr', [prompt],
    { env: { ...process.env, IBR_DAEMON: 'true', ...env }, reject: false }
  );

  if (exitCode !== 0) {
    // Structured error object is on stderr (find the {"error"...} line).
    const errLine = stripAnsi(stderr).split('\n').find(l => l.trim().startsWith('{"error"'));
    const { error } = errLine ? JSON.parse(errLine) : { error: { code: 'UNKNOWN' } };
    throw Object.assign(new Error(error.message), { code: error.code });
  }

  return parseDaemonStdout(stdout).extracts;   // e.g. [[{"verdict":"PAGE_OK"}]]
}

const results = await runIbr(`url: https://news.ycombinator.com
instructions:
  - extract the top 5 stories with title and points`);
```

### Tool pipeline (stateless — `tool` cannot use the daemon)

`ibr tool …` always runs stateless, so slice the extraction out of the console
log (same as [Extraction Output](#extraction-output-stateless-mode-stdout)).

```javascript
import { execa } from 'execa';

const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*m/g, '');
function parseStatelessExtracts(stdout) {
  const lines = stripAnsi(stdout).split('\n');
  const start = lines.findIndex(l => l.includes('info: Extracted data:'));
  if (start === -1) return [];
  const body = lines.slice(start + 1).join('\n').replace(/ \{"service":"ibr"\}\s*$/m, '');
  const end = body.lastIndexOf('\n]') + 2;      // end of the top-level array
  return JSON.parse(body.slice(0, end > 1 ? end : body.length));
}

async function runTool(name, params) {
  const args = ['tool', name, ...Object.entries(params).flatMap(([k, v]) => ['--param', `${k}=${v}`])];
  const { stdout, exitCode } = await execa('ibr', args, { reject: false });
  if (exitCode !== 0) throw new Error(`tool ${name} failed`);
  return parseStatelessExtracts(stdout);
}

const [papers, packages] = await Promise.all([
  runTool('arxiv', { query: 'LLM agents', max_results: '5' }),
  runTool('npm',   { package: 'ai' }),
]);
```

---

## Daemon Mode (persistent browser + clean JSON)

Reduces per-invocation overhead from ~3800ms to ~540ms warm, and returns a
structured `{"extracts":[...],"tokenUsage":{...}}` object on stdout (preceded by
one `Starting ibr …` banner line) — far easier to parse than stateless mode.

```bash
# First call starts daemon; subsequent calls reuse it
IBR_DAEMON=true ibr "url: https://example.com ..."

# State file (port, pid, token)
cat ~/.ibr/server.json        # → {"port":3847,"pid":12345,"token":"..."}
IBR_STATE_FILE=/tmp/ibr.json  # override path (useful for isolated test envs)

# Teardown
kill $(jq .pid ~/.ibr/server.json)
```

Daemon mode takes a **direct prompt only** — `ibr tool <name>`, `snap`,
`version`, `upgrade`, and the `--cookies` / `--mode` stateless flags are not
routed through it. Use stateless invocation for those.

---

## Key Agent Environment Variables

| Variable | Recommendation |
|----------|----------------|
| `IBR_DAEMON=true` | Persistent browser + clean `{extracts,tokenUsage}` stdout — the parse-friendly path |
| `NODE_ENV=production` | Drops console verbosity from `debug` to `info` (there is **no `LOG_LEVEL`** — it is ignored) |
| `BROWSER_HEADLESS=true` | Default; the headless CI/agent mode |
| `BROWSER_SLOWMO=0` | Fastest execution (remove anti-bot delays) |
| `BROWSER_TIMEOUT=10000` | Tighter per-action timeout for agent loops; adjust per site |
| `EXECUTION_TIMEOUT_MS=60000` | Hard global cap on a run → `TIMEOUT` error if exceeded |
| `NDJSON_STREAM=true` | Real-time events (stderr) for monitoring/streaming agents |
| `AI_TEMPERATURE=0` | Deterministic outputs (always 0 for agents) |
| `OPENAI_BASE_URL=<url>` | Point at an OpenAI-compatible endpoint (local model) |
| `ANNOTATED_SCREENSHOTS_ON_FAILURE=true` | Auto-capture debug PNGs on failure |
| `OBEY_ROBOTS=true` | Compliant scraping; exit 1 (`ROBOTS_DISALLOWED`) if path disallowed |
| `IBR_WAIT_FOR_HUMAN_ALLOW_PIPED=true` | Only if a prompt intentionally waits for a line on piped stdin (otherwise such a step fails fast — see below) |
| `VISUAL_AI_MODEL=<model>` | Use stronger vision model for `--mode visual` or auto-escalation; text remains on `AI_MODEL` |
| `VISUAL_MAX_ESCALATIONS=3` | Limit auto-escalation to visual per run (explicit `--mode visual` ignores) |
| `VISUAL_GRID=8x8` | Grid fallback dimensions (RxC) when no interactive elements detected |

Use `--quiet` to drop progress lines from stderr in a subprocess; the structured
error object and NDJSON events still come through.

---

## Error Handling Matrix

| Symptom | `error.code` | Recommended Action |
|---------|-------------|-------------------|
| Missing prompt or URL | `CONFIG_ERROR` | Fix prompt construction; validate before invoking |
| Missing required `--param` | `CONFIG_ERROR` | Check required params before calling `ibr tool` |
| No API key / bad env var | `CONFIG_ERROR` | Check `AI_PROVIDER` + corresponding key env var |
| AI returned garbage | `AI_PARSE_ERROR` | Retry once; fall back to simpler prompt |
| Element not found | `RUNTIME_ERROR` (+ `step`/`action`) | Use `ibr snap -i` to inspect; try `--mode dom` |
| Per-action timeout | `RUNTIME_ERROR` | Increase `BROWSER_TIMEOUT`; retry with backoff |
| Global run timeout | `TIMEOUT` | Raise `EXECUTION_TIMEOUT_MS` or trim the workflow |
| robots.txt blocked | `ROBOTS_DISALLOWED` | Remove `--obey-robots` or change target URL |
| No usable Chromium | `RUNTIME_ERROR` | Message names the fix: `npx playwright install chromium` or `BROWSER_CHANNEL=chrome`; ibr already tried cached + system builds |
| "wait for me to …" on piped stdin | `WAIT_FOR_HUMAN_NO_TTY` | Rephrase as a timed wait, or set `IBR_WAIT_FOR_HUMAN_ALLOW_PIPED=true` |
| Piped stdin closed mid-wait | `WAIT_FOR_HUMAN_STDIN_CLOSED` | Feed a line on stdin, or drop the human-wait step |

---

## snap as Lightweight Pre-flight

Use `ibr snap` (no AI, no API key) to validate page structure before
committing to a full ibr run. The DOM JSON is a **single line** (not
pretty-printed) written after a `=== DOM Tree ===` header, but a couple of
winston log lines precede it on stdout — isolate the JSON line with
`grep '^{'` (or `grep '^-' ` for the ARIA YAML):

```bash
# Exit 0 = page reachable + DOM parseable. Grab the single JSON line.
ibr snap https://target.example.com -i -d 3 2>/dev/null \
  | grep '^{' \
  | jq 'recurse(.c[]?) | select(.n == "BUTTON") | .t'

# Gate: only proceed if target element is present
if ibr snap https://app.example.com -i 2>/dev/null | grep '^{' | grep -q '"login"'; then
  ibr "url: https://app.example.com ..."
fi
```

snap flags: `--aria` (semantic ARIA YAML), `-i` (interactive only), `-d N`
(depth, dom mode), `-s <selector>` (scope, dom mode), `-a` (annotated screenshot
→ `/tmp/ibr-dom-annotated.png`). Node keys: `x` index, `n` tag, `t` text,
`a` attrs, `c` children.

---

## Lightpanda (fast headless, beta)

Zig-built headless browser; ~9× faster startup, ~16× less memory than Chromium.
Opt-in, auto-downloaded on first use.

- `BROWSER_CHANNEL=lightpanda` — auto-download + spawn + connect via CDP
- Recommended during beta: `BROWSER_FALLBACK=chromium` — silently retries on
  chromium when lightpanda hits an unimplemented Web API. Failures recorded
  in `~/.cache/ibr/browsers/lightpanda/capabilities.json` for future
  pre-flight warnings
- Pre-warm in CI: `ibr browser pull lightpanda stable`
- Inspect resolver: `ibr browser which` (dry-run; no spawn)
- Cache GC: `ibr browser prune --older-than 30d`
- Connect-only mode: `BROWSER_CDP_URL=ws://127.0.0.1:9222` (skip spawn;
  caller manages lifecycle). `LIGHTPANDA_WS` is a deprecated alias
- Strict gating: `BROWSER_STRICT=true` refuses launch if capability manifest
  has known-broken entries for the current version
- Known limitation: CORS not implemented upstream; cross-origin
  `page.evaluate(() => fetch(...))` calls will fail. Use fallback
- Telemetry: disabled by default; opt-in via `LIGHTPANDA_TELEMETRY=true`
- See `docs/testing-lightpanda.md` for the gated e2e suite (`BROWSER_E2E=lightpanda`)
