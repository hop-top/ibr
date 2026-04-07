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
BROWSER_HEADLESS=false          # false = visible window, true = headless
BROWSER_SLOWMO=100              # ms delay between actions (0 = fastest)
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
| `chromium` | Chromium (Linux) |

macOS: Keychain dialog appears on first use per browser — click **Allow**.

---

## Page Representation (`--mode`)

```bash
ibr --mode aria "<prompt>"   # force ARIA tree (semantic SPAs, forms)
ibr --mode dom  "<prompt>"   # force DOM+XPath (canvas, legacy, shadow DOM)
ibr --mode auto "<prompt>"   # default — auto quality-based selection
```

---

## Visual Debugging

```bash
ibr --annotate "<prompt>"                        # annotated PNG after each find step
ibr -a "<prompt>"                                # shorthand
ANNOTATED_SCREENSHOTS_ON_FAILURE=true ibr "..."  # auto-capture on any failure
```

Output: `/tmp/ibr-annotate-step-<N>-<ts>.png` / `/tmp/ibr-failure-step-<N>-<ts>.png`

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
| `github-search` | `query` | `type` (repositories) |
| `github-trending` | _(none)_ | `language`, `period` (daily) |
| `github-starred` | `username` | `query` |
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
| `BROWSER_HEADLESS` | `false` | `true` = headless |
| `BROWSER_SLOWMO` | `100` | ms between actions |
| `BROWSER_TIMEOUT` | `30000` | ms per action |
| `BROWSER_CHANNEL` | _(chromium)_ | `brave` / `chrome` / `msedge` / `arc` / `comet` |
| `BROWSER_EXECUTABLE_PATH` | — | Explicit browser binary path (overrides `BROWSER_CHANNEL`) |
| `IBR_DAEMON` | `false` | Enable daemon mode |
| `IBR_STATE_FILE` | `~/.ibr/server.json` | Daemon state file path |
| `OBEY_ROBOTS` | `false` | Robots.txt compliance |
| `NDJSON_STREAM` | `false` | Emit structured browser events |
| `ANNOTATED_SCREENSHOTS_ON_FAILURE` | `false` | Auto-capture on failure |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |

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
LOG_LEVEL=debug ANNOTATED_SCREENSHOTS_ON_FAILURE=true \
  ibr --annotate "url: https://example.com ..." 2>ibr.log
# Review PNGs in /tmp/ibr-annotate-*.png and ibr.log
```

### Force a specific AI model per run

```bash
AI_MODEL=claude-opus-4-6 AI_PROVIDER=anthropic ibr "url: ... complex multi-step task"
AI_MODEL=gpt-4o ibr "url: ... quick extraction"
```

### NDJSON streaming for pipeline integration

```bash
NDJSON_STREAM=true ibr "url: https://example.com ..." \
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
