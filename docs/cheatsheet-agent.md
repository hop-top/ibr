# ibr Cheatsheet — Agent / Script Invocation

Quick reference for autonomous agents, scripts, and LLMs invoking ibr as a
subprocess or composing tool pipelines. Scannable in 30 seconds.

---

## Invocation Contract

```
1. Build prompt   →  url: + instructions: block (or natural-language string)
2. Run ibr        →  capture stdout (extraction JSON), stderr (logs + events)
3. Gate on exit   →  0 = success, 1 = failure (check before parsing stdout)
4. Parse output   →  JSON array on stdout after "Task execution completed"
5. Handle errors  →  JSON error object on stderr: {"error":{"code":"...","message":"..."}}
```

**DO:** check exit code before parsing stdout.
**DO:** parse the structured error JSON from stderr on non-zero exit.
**DON'T:** assume stdout is valid JSON if exit ≠ 0.
**DON'T:** suppress stderr — it carries the structured error payload.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Task completed successfully |
| `1` | Any failure (config error, AI error, browser error, robots block) |

Discriminate failure type via the `error.code` field in the stderr JSON object.

---

## Structured Error Output (stderr)

On failure, ibr emits one JSON object to stderr:

```json
{"error":{"code":"CONFIG_ERROR","message":"No user prompt provided..."}}
{"error":{"code":"AI_PARSE_ERROR","message":"AI model returned an empty response..."}}
{"error":{"code":"RUNTIME_ERROR","message":"...", "step": 2, "action": "click"}}
{"error":{"code":"ROBOTS_DISALLOWED","message":"Target URL is disallowed by robots.txt..."}}
```

| Error Code | Trigger |
|------------|---------|
| `CONFIG_ERROR` | Missing prompt, invalid flag, bad env var |
| `AI_PARSE_ERROR` | AI returned unparseable response |
| `RUNTIME_ERROR` | Browser action failed during execution |
| `ROBOTS_DISALLOWED` | robots.txt check failed (`--obey-robots`) |

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

## Extraction Output (stdout)

On success, stdout contains a JSON array after log lines:

```
[2026-03-31T12:00:00.000Z] info: Starting ibr ...
[2026-03-31T12:00:01.000Z] info: Task execution completed
[{"title":"Result 1","url":"https://example.com","price":"$99"}]
```

Extract JSON reliably:
```bash
ibr "..." 2>/dev/null | grep '^\[' | tail -1 | jq '.'
```

Or in Node.js:
```javascript
const lines = stdout.trim().split('\n');
const jsonLine = lines.findLast(l => l.startsWith('[') || l.startsWith('{'));
const data = JSON.parse(jsonLine);
```

---

## NDJSON Event Stream (`NDJSON_STREAM=true`)

For real-time event consumption without polling. Events go to **stderr**.

```bash
NDJSON_STREAM=true ibr "..." 2>events.ndjson
```

### Event Schema

```json
{"event":"task_start","timestamp":"2026-03-31T12:00:00.000Z","prompt":"url: ..."}
{"event":"navigation","timestamp":"...","url":"https://example.com","status":"ok"}
{"event":"click","timestamp":"...","selector":"//button[1]","status":"ok"}
{"event":"fill","timestamp":"...","selector":"//input[1]","valueLength":12,"status":"ok"}
{"event":"extract","timestamp":"...","field":"title","value":"Page Title","status":"ok"}
{"event":"task_end","timestamp":"...","duration_ms":3421,"status":"completed"}
{"event":"error","timestamp":"...","instruction":"click","error":"Element not found"}
```

### Event Types

| Event | Meaning |
|-------|---------|
| `task_start` | Execution begins; includes prompt |
| `navigation` | Page navigation; includes url + status |
| `click` | Click action; includes selector + status |
| `fill` | Fill action; includes selector + valueLength |
| `extract` | Extraction step; includes field + value |
| `task_end` | Run complete; includes duration_ms + status |
| `error` | Instruction-level failure; includes instruction + error |

### Filter by event type

```bash
NDJSON_STREAM=true ibr "..." 2>&1 1>/dev/null \
  | jq -c 'select(.event == "extract")'

# All failures only
  | jq -c 'select(.event == "error" or .status == "error")'
```

---

## Tool Subcommand Output

`ibr tool <name> --param k=v` follows the same contract: stdout = JSON array,
stderr = logs + errors, exit 0/1.

```bash
result=$(ibr tool arxiv --param query="LLM agents" 2>/dev/null)
echo "$result" | jq '.[0].title'
```

Missing required param → exit 1 **before** browser launch:
```json
{"error":{"code":"CONFIG_ERROR","message":"Missing required param: query. Pass it with --param query=<value>."}}
```

List available tools (machine-readable):
```bash
ibr tool --list 2>/dev/null
```

---

## Invocation Patterns

### Shell subprocess

```bash
#!/usr/bin/env bash
set -euo pipefail

output=$(ibr "url: https://example.com
instructions:
  - extract the h1 heading" 2>/tmp/ibr-err.log)

if [ $? -ne 0 ]; then
  code=$(grep -o '"code":"[^"]*"' /tmp/ibr-err.log | cut -d'"' -f4)
  echo "ibr failed: $code" >&2
  exit 1
fi

echo "$output" | grep '^\[' | tail -1 | jq '.[0]'
```

### Node.js subprocess

```javascript
import { execa } from 'execa';

async function runIbr(prompt, env = {}) {
  const { stdout, stderr, exitCode } = await execa(
    'ibr', [prompt],
    { env: { ...process.env, ...env }, reject: false }
  );

  if (exitCode !== 0) {
    const errLine = stderr.split('\n').find(l => l.startsWith('{"error"'));
    const { error } = errLine ? JSON.parse(errLine) : { error: { code: 'UNKNOWN' } };
    throw Object.assign(new Error(error.message), { code: error.code });
  }

  const jsonLine = stdout.trim().split('\n').findLast(l => l.startsWith('['));
  return JSON.parse(jsonLine);
}

// Usage
const results = await runIbr(`url: https://news.ycombinator.com
instructions:
  - extract the top 5 stories with title and points`);
```

### Tool pipeline

```javascript
// Run multiple tools in parallel
const [papers, trends, packages] = await Promise.all([
  runTool('arxiv',        { query: 'LLM agents', max_results: '5' }),
  runTool('trend-search', { topic: 'ai agents' }),
  runTool('npm',          { package: 'ai' }),
]);

async function runTool(name, params) {
  const args = ['tool', name, ...Object.entries(params).flatMap(([k,v]) => ['--param', `${k}=${v}`])];
  const { stdout, exitCode } = await execa('ibr', args, { reject: false });
  if (exitCode !== 0) throw new Error(`tool ${name} failed`);
  return JSON.parse(stdout.trim().split('\n').findLast(l => l.startsWith('[')));
}
```

---

## Daemon Mode (persistent browser)

Reduces per-invocation overhead from ~3800ms to ~540ms warm.

```bash
# First call starts daemon; subsequent calls reuse it
IBR_DAEMON=true ibr "url: https://example.com ..."

# State file (port, pid, token)
cat ~/.ibr/server.json        # → {"port":3847,"pid":12345,"token":"..."}
IBR_STATE_FILE=/tmp/ibr.json  # override path (useful for isolated test envs)

# Teardown
kill $(jq .pid ~/.ibr/server.json)
```

Daemon is **not** compatible with `--cookies` or `--mode` (stateless flags).

---

## Key Agent Environment Variables

| Variable | Recommendation |
|----------|----------------|
| `LOG_LEVEL=error` | Suppress info/debug noise; only errors reach stderr |
| `BROWSER_HEADLESS=true` | Required for headless CI/agent environments |
| `BROWSER_SLOWMO=0` | Fastest execution (remove anti-bot delays) |
| `BROWSER_TIMEOUT=10000` | Tighter timeout for agent loops; adjust per site |
| `NDJSON_STREAM=true` | Real-time events for monitoring/streaming agents |
| `IBR_DAEMON=true` | Persistent browser for high-frequency invocations |
| `AI_TEMPERATURE=0` | Deterministic outputs (always 0 for agents) |
| `ANNOTATED_SCREENSHOTS_ON_FAILURE=true` | Auto-capture debug PNGs on failure |
| `OBEY_ROBOTS=true` | Compliant scraping; exit 1 if path disallowed |

---

## Error Handling Matrix

| Symptom | `error.code` | Recommended Action |
|---------|-------------|-------------------|
| Missing prompt or URL | `CONFIG_ERROR` | Fix prompt construction; validate before invoking |
| Missing required `--param` | `CONFIG_ERROR` | Check required params before calling `ibr tool` |
| AI returned garbage | `AI_PARSE_ERROR` | Retry once; fall back to simpler prompt |
| Element not found | `RUNTIME_ERROR` + `step` N | Use `ibr snap -i` to inspect; try `--mode dom` |
| robots.txt blocked | `ROBOTS_DISALLOWED` | Remove `--obey-robots` or change target URL |
| No API key | `CONFIG_ERROR` | Check `AI_PROVIDER` + corresponding key env var |
| Timeout | `RUNTIME_ERROR` | Increase `BROWSER_TIMEOUT`; retry with backoff |

---

## snap as Lightweight Pre-flight

Use `ibr snap` (no AI, no API key) to validate page structure before
committing to a full ibr run:

```bash
# Exit 0 = page reachable + DOM parseable; stdout = structure
ibr snap https://target.example.com -i -d 3 2>/dev/null \
  | jq 'recurse(.c[]?) | select(.n == "BUTTON") | .t'

# Gate: only proceed if target element is present
if ibr snap https://app.example.com -i 2>/dev/null | grep -q '"login"'; then
  ibr "url: https://app.example.com ..."
fi
```

snap flags: `--aria` (semantic tree), `-i` (interactive only), `-d N` (depth),
`-s <selector>` (scope), `-a` (annotated screenshot → `/tmp/ibr-dom-annotated.png`).
