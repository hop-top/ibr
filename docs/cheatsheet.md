# ibr Cheatsheet

Quick reference for daily use. Scannable in 30 seconds.

---

## Start

```bash
npm install @hop/ibr            # install
npm run browser:install         # install Playwright browser
ibr version                     # verify install
```

Config: `.env` (copy from `.env.example`)

```env
AI_PROVIDER=openai              # openai | anthropic | google
OPENAI_API_KEY=sk-...
BROWSER_HEADLESS=false          # default true (headless); set false for a visible window
BROWSER_SLOWMO=100              # ms delay between actions (0 = fastest)
```

Point at a local / OpenAI-compatible endpoint (LM Studio, Ollama, vLLM):

```env
AI_PROVIDER=openai
OPENAI_BASE_URL=http://localhost:1234/v1
OPENAI_API_KEY=not-needed       # some local servers ignore this, but it must be set
AI_MODEL=your-local-model
```

---

## Run a Prompt

```bash
ibr "url: https://example.com
instructions:
  - click the submit button
  - extract the confirmation message"
```

Single-line shorthand (URL inferred):

```bash
ibr "go to https://example.com and extract the page title"
```

From stdin:

```bash
echo "url: https://example.com
instructions:
  - extract the h1" | ibr
```

---

## Verdict / Status Checks

Ask for a status token and ibr returns it as a structured verdict object instead
of scraped page text — handy for gating scripts and CI.

```bash
ibr 'url: https://example.com
instructions:
  - report PAGE_OK if the heading "Example Domain" is shown, or PAGE_FAILED'
# → extracted data contains: {"verdict":"PAGE_OK"}
```

Any `report/return/emit <UPPER_SNAKE token> …` instruction (`PAGE_OK`,
`LOGIN_FAILED`, `STATUS_GREEN`, …) triggers verdict mode. Ordinary "extract the
prices for each row" instructions are untouched.

---

## Progress Feedback (`--quiet`)

By default, multi-instruction runs print live per-instruction progress to
**stderr** (n/N + label + elapsed) so a long run never looks hung. It never
touches stdout, so pipelines are unaffected.

```bash
ibr "<prompt>"            # progress on stderr (spinner on a TTY)
ibr --quiet "<prompt>"    # silence progress
ibr -q "<prompt>"         # shorthand
```

---

## Skip Augmentations (`--raw`)

```bash
ibr --raw "<prompt>"                    # skip domain-specific augmentations
ibr --ignore-augmentations "<prompt>"   # same thing, long form
```

Use when a site-specific augmentation is interfering and you want the plain
resolver behaviour.

---

## Authenticated Sessions (`--cookies`)

Import live browser cookies — no manual export, no proxy.

```bash
ibr --cookies chrome "<prompt>"                  # all Chrome cookies
ibr --cookies arc:github.com "<prompt>"          # Arc, github.com only
ibr --cookies brave:app.example.com,api.example.com "<prompt>"
```

| Alias | Browser |
|-------|---------|
| `chrome` | Google Chrome |
| `brave` | Brave |
| `edge` | Microsoft Edge |
| `arc` | Arc (macOS) |
| `comet` | Comet / Perplexity (macOS) |
| `chromium` | Chromium (Linux / Windows) |

macOS: Keychain dialog appears on first use per browser — click **Allow**.

---

## Page Representation (`--mode`)

```bash
ibr --mode aria    "<prompt>"   # force ARIA tree (semantic SPAs, forms)
ibr --mode dom     "<prompt>"   # force DOM+XPath (canvas, legacy, shadow DOM)
ibr --mode visual  "<prompt>"   # screenshot + Set-of-Marks; vision-based element detection
ibr --mode auto    "<prompt>"   # default — auto quality-based; escalates aria → dom → visual
```

Auto escalation: in `--mode auto`, when the aria + dom text attempt fails (the model reports `"outcome": "not_found"`, or the action on a found element throws), ibr escalates to visual (screenshot + numbered overlays sent to LLM). Capped at `VISUAL_MAX_ESCALATIONS` (default 3). Visual uses vision tokens (~1000–2000/screenshot); prefer text modes for cost.

The model's `outcome` on an element-less reply decides whether escalation happens at all:

| `outcome` | Means | Auto-mode effect |
|-----------|-------|------------------|
| `found` | The reply carries the element(s) to act on | Normal action |
| `not_found` | Looked for the named element, it is not on the page — a genuine miss | Escalates to visual |
| `no_element_needed` | The step needs no element (page-level `scroll`, an optional action legitimately absent) | Skipped; no escalation, no vision call |
| _(absent / unrecognised)_ | The model said nothing | Skipped, exactly as before this field existed |

---

## Visual Debugging & Mode

### --annotate (disk sink)

```bash
ibr --annotate "<prompt>"                        # annotated PNG after each find step
ibr -a "<prompt>"                                # shorthand
ANNOTATED_SCREENSHOTS_ON_FAILURE=true ibr "..."  # auto-capture on any failure
```

Output: `/tmp/ibr-annotate-step-<N>-<ts>.png` / `/tmp/ibr-failure-step-<N>-<ts>.png`

### --mode visual + --annotate (both sinks)

```bash
ibr --mode visual --annotate "<prompt>"   # screenshot to LLM + disk (same marked frame)
```

The marked frame is both the model input AND written to `/tmp/…png` for inspection.

### What the visual path can perform

The visual path acts on a *mark* — a specific element or grid cell the model
picked out of the screenshot. Only `click`, `fill`, `type` and `press` mean
anything against a mark, so those are the only action types it performs.

Anything else — `scroll` above all — is **refused, not substituted**. A
page-level scroll needs no element, so a `scroll` arriving here has already
claimed a missing element target; scrolling to the model's guess, or
wheel-scrolling at a cell, would silently perform a *different* action than the
one asked for. Refusal is deliberate: earlier versions fell through to a click.

- Under `--mode auto`, a `scroll` never spends an escalation or a vision call —
  it is skipped before the screenshot is taken.
- Under explicit `--mode visual`, an element-backed mark logs the refusal and
  skips the step; a grid cell raises `UNSUPPORTED_VISUAL_ACTION`.

### Grid cells honour the action type and its value

When no interactive elements are detected (canvas, unlabelled pages), the
overlay falls back to a labelled grid (`VISUAL_GRID`, default `8x8`). A grid
mark is a coordinate, not an element, so text entry clicks the cell centre to
focus it and then types on the keyboard:

| Action | On a grid cell |
|--------|----------------|
| `click` | Mouse click at the cell centre |
| `fill` / `type` | Click the centre to focus, then `keyboard.type(value)` |
| `press` | Click the centre to focus, then `keyboard.press(value)` |

A `fill`/`type`/`press` with no value is refused with `MISSING_ACTION_VALUE`
rather than degraded to a bare click — dropping the value silently and
reporting success is the worse outcome. State the text or key explicitly in the
instruction (e.g. `type 'hello' into the canvas field`).

---

## Daemon Mode (faster warm starts)

```bash
IBR_DAEMON=true ibr "<prompt>"   # start daemon + run (540ms warm vs 3800ms cold)
ibr --daemon "<prompt>"          # flag form
cat ~/.ibr/server.json           # port, pid, token
kill $(jq .pid ~/.ibr/server.json)  # stop daemon
```

---

## DOM Inspector (`ibr snap`)

Inspect page structure without AI or browser session.

```bash
ibr snap https://example.com              # simplified DOM JSON → stdout
ibr snap https://example.com --aria       # ARIA snapshot instead
ibr snap https://example.com -i           # interactive elements only
ibr snap https://example.com -d 5         # depth limit 5
ibr snap https://example.com -s "#main"   # scope to CSS selector
ibr snap https://example.com -a           # annotated screenshot → /tmp/ibr-dom-annotated.png
```

---

## Tool Runner (`ibr tool`)

Run pre-packaged YAML-defined workflows.

```bash
ibr tool <name> [--param key=value ...]
ibr tool --list                           # list available tools
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

### Examples

```bash
ibr tool web-search --param query="playwright testing"
ibr tool github-trending --param language=go --param period=weekly
ibr tool context7 --param library=react --param question="how to use useEffect"
ibr tool arxiv --param query="attention transformer" --param max_results=3
ibr tool wikipedia --param topic=Playwright --param section=History
ibr tool yahoo-finance --param ticker=AAPL
ibr tool reddit --param query="rust async" --param subreddit=rust
```

### Custom Tool (YAML)

Place `.yaml` in `tools/` → available as `ibr tool <name>`:

```yaml
name: my-tool
description: "Short description"
params:
  - name: query
    description: "Search query"
    required: true
  - name: count
    default: "5"
url: "https://example.com/search?q={{query}}"
instructions:
  - extract the top {{count}} results with titles and URLs
```

---

## robots.txt Compliance

```bash
ibr --obey-robots "<prompt>"         # abort if path disallowed
OBEY_ROBOTS=true ibr "<prompt>"      # env var form
```

---

## Version & Upgrade

```bash
ibr version                  # human-readable version
ibr version --short          # version only (scriptable)
ibr version --json           # JSON with node/platform info
ibr upgrade                  # check for updates
ibr upgrade --auto           # install if available
ibr upgrade --quiet          # suppress output
ibr upgrade preamble         # emit agent skill preamble fragment
```

---

## Key Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_PROVIDER` | `openai` | `openai` / `anthropic` / `google` |
| `AI_MODEL` | _(provider default)_ | Override model (e.g. `gpt-4.1`) |
| `AI_TEMPERATURE` | `0` | 0–2; 0 = deterministic |
| `OPENAI_BASE_URL` | _(OpenAI cloud)_ | Point at an OpenAI-compatible endpoint (local model) |
| `BROWSER_HEADLESS` | `true` | `false` = show a visible window |
| `BROWSER_SLOWMO` | `100` | ms between actions |
| `BROWSER_TIMEOUT` | `30000` | ms per action |
| `BROWSER_CHANNEL` | _(chromium)_ | `brave` / `chrome` / `msedge` / `arc` / `comet` |
| `BROWSER_EXECUTABLE_PATH` | — | Explicit browser binary path (overrides `BROWSER_CHANNEL`) |
| `BROWSER_PROFILE` | `Default` | Browser profile to read cookies from |
| `EXECUTION_TIMEOUT_MS` | _(none)_ | Global cap on a run, in ms (e.g. `60000`) |
| `IBR_DAEMON` | `false` | Enable daemon mode |
| `IBR_STATE_FILE` | `~/.ibr/server.json` | Daemon state file path |
| `OBEY_ROBOTS` | `false` | Robots.txt compliance |
| `NDJSON_STREAM` | `false` | Also emit structured browser events (stderr) |
| `ANNOTATED_SCREENSHOTS_ON_FAILURE` | `false` | Auto-capture on failure |
| `IBR_WAIT_FOR_HUMAN_ALLOW_PIPED` | `false` | Allow "wait for me to …" to block on piped stdin |
| `VISUAL_AI_MODEL` | _(AI_MODEL)_ | Vision model for visual mode only (overrides AI_MODEL when vision-based) |
| `VISUAL_MAX_ESCALATIONS` | `3` | Auto-escalation cap (explicit --mode visual ignores) |
| `VISUAL_GRID` | `8x8` | Grid fallback dimensions (RxC format) |

Console logs (info/debug, colorized) go to **stdout**; progress + structured
events go to **stderr**. Verbosity is `debug` unless `NODE_ENV=production` (then
`info`). See `.env.example` for the full ~40-var list.

---

## Pro Tips

### Pipe results into other tools

```bash
# Extract JSON → jq
ibr "url: https://hn.algolia.com/?q=rust&type=story
instructions:
  - extract top 10 stories with title, points, url" | jq '.[].title'

# Feed ibr output into ctxt
ibr tool web-search --param query="ibr playwright" | ctxt analyze --type text --hints "#research"

# Chain ibr → ibr via stdin
ibr tool arxiv --param query="LLM agents" | ibr "url: -
instructions:
  - summarise the key contributions of each paper"
```

### Scope cookies tightly to reduce noise

```bash
# Bad — imports thousands of cookies, may confuse AI context
ibr --cookies chrome "url: https://github.com ..."

# Better — only what's needed
ibr --cookies chrome:github.com "url: https://github.com ..."
```

### Snap first, automate second

```bash
# Inspect interactive elements before writing a prompt
ibr snap https://app.example.com -i -d 4

# Force dom mode on canvas/shadow-DOM apps
ibr snap https://figma.com --mode dom -i
```

### Combine snap + AI prompt for hard pages

```bash
# Capture the raw structure, pipe into an ibr prompt
ibr snap https://app.example.com -i | ibr "given this DOM:
$(cat -)
write ibr instructions to click the primary CTA"
```

### Daemon for high-frequency scripting

```bash
# Start daemon once; all subsequent calls are ~540ms
IBR_DAEMON=true ibr "url: https://example.com/step1 ..."
IBR_DAEMON=true ibr "url: https://example.com/step2 ..."

# Stop
kill $(jq .pid ~/.ibr/server.json)
```

### Structured output → CSV pipeline

```bash
ibr tool amazon --param query="mechanical keyboards" --param max_results=20 \
  | jq -r '.[] | [.title, .price, .rating] | @csv' \
  > keyboards.csv
```

### Batch tool runs with xargs

```bash
# Search arxiv for multiple topics in parallel
echo -e "LLM agents\ntransformer attention\nRAG retrieval" \
  | xargs -P3 -I{} ibr tool arxiv --param query="{}" --param max_results=3
```

### Debug a stuck flow with annotate + logs

```bash
ANNOTATED_SCREENSHOTS_ON_FAILURE=true \
  ibr --annotate "url: https://example.com ..." >ibr.log
# Console logs (debug detail included) go to stdout → ibr.log
# Review PNGs in /tmp/ibr-annotate-*.png
```

### Force a specific AI model per run

```bash
AI_MODEL=claude-opus-4-6 AI_PROVIDER=anthropic ibr "url: ... complex multi-step task"
AI_MODEL=gpt-4o ibr "url: ... quick extraction"
```

### NDJSON streaming for pipeline integration

```bash
# Events go to stderr — redirect stderr into the pipe (2>&1 1>/dev/null)
NDJSON_STREAM=true ibr "url: https://example.com ..." 2>&1 1>/dev/null \
  | jq -c 'select(.event == "extract")' \
  | while read line; do echo "$line" | process_event; done
```

### robots.txt as a gate in CI

```bash
# Fail fast if site disallows automation
OBEY_ROBOTS=true ibr "url: https://example.com ..." || exit 1
```

---

## Common Failure Modes

| Symptom | Fix |
|---------|-----|
| Element not found | Try `--mode dom`; use `ibr snap -i` to inspect interactives |
| Auth-gated page blocked | Add `--cookies <browser>` |
| macOS Keychain dialog | Click **Allow** when prompted |
| Browser DB locked | Close the browser and retry |
| AI timeout / empty response | Check API key; increase `BROWSER_TIMEOUT` |
| Wrong elements clicked | Use `--annotate` to visualise resolved elements |
| Prompt rejected (no URL) | Include `url:` field or a bare `https://` in prompt |
| robots.txt abort | Remove `--obey-robots` or target a different URL |
| "No usable Chromium browser found" | Run `npx playwright install chromium`, or set `BROWSER_CHANNEL=chrome` (ibr auto-tries cached + system builds first) |
| "wait for me to log in" hangs / errors when piped | Human-waits need a TTY; run interactively, or set `IBR_WAIT_FOR_HUMAN_ALLOW_PIPED=true` to wait on stdin. Page/element waits ("wait for the page to load") are timed waits — no TTY needed |
