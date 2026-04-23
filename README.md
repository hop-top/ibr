# ibr - Intent Browser Runtime

An AI-powered instruction parser that converts human-readable instructions into automated web interactions. Powered by Playwright for browser automation and Vercel AI SDK for multi-provider AI support.

## Features

- **Multi-Provider AI Support**: OpenAI, Anthropic Claude, Google Gemini
- **Natural Language Instructions**: Describe what you want in plain English
- **Automatic Element Detection**: AI finds elements based on descriptions
- **Data Extraction**: Extract structured data from web pages
- **Conditional Logic**: If-then instructions for dynamic flows
- **Loop Support**: Repeat actions until conditions are met
- **Authenticated Sessions**: Inherit browser cookies via `--cookies` flag
- **Snapshot Diffing**: 85% token reduction in loops via incremental DOM diffs
- **Tool Runner**: `ibr tool` subcommand — YAML-defined reusable browser workflows with typed params
- **DOM Inspector**: `ibr snap` subcommand for on-demand page inspection
- **Daemon Mode**: Optional persistent browser server; warm invocations ~540ms vs ~3800ms cold
- **Visual Debugging**: `--annotate` / `-a` flag captures annotated PNGs with labeled bounding boxes
- **Failure Screenshots**: `ANNOTATED_SCREENSHOTS_ON_FAILURE=true` auto-captures on action failure
- **Dialog Handling**: Auto-accepts browser dialogs; buffers history for inspection
- **Comprehensive Logging**: Detailed execution logs for debugging
- **NDJSON Streaming**: `NDJSON_STREAM=true` emits structured browser events for pipeline integration
- **Augmentation Engine**: URL-aware DOM mutations (remove, isolate, addClass) and scripting to pre-process pages
- **Self-Healing**: Autonomous bypass of obstructions (paywalls, modals) using `@hop-top/fit` SDK
- **Run Recording**: Deterministic record/replay of AI interactions using `@hop-top/xrr` cassettes
- **Contextual Learning**: Healing logic learns from previous successful bypasses on similar page structures
- **Cloud Orchestration**: Multi-provider account pooling and rotation (browser-use, browserless, etc.)
- **Proactive Infra Routing**: URL-aware infrastructure selection (e.g. force Cloud for Jira or high-entropy domains)
- **Infra-Switching**: Autonomous migration from local to cloud browser during self-healing
- **CDP Tab Reuse**: Connect to running browser via `BROWSER_CDP_URL` + reuse existing authenticated tabs with `BROWSER_REUSE_PAGE=true`
- **Custom Launch Args**: `BROWSER_ARGS` env var for Chromium flags (`--user-data-dir`, `--profile-directory`)
- **Popup Auto-Switch**: After click opens a popup window, ibr preemptively switches context for subsequent instructions; auto-returns on popup close
- **Strict Mode Scoping**: When multiple identical elements match (e.g. 9 "delete" links), ibr extracts disambiguating text from the instruction prompt and scopes to the nearest ancestor row

## Setup

### Setup prompt

Paste into Claude Code or Codex:

```text
Set up https://github.com/hop-top/ibr for me.

Follow the README.md to install dependencies and run the browser installation. Configure the environment by copying `.env.example` to `.env` and ask me for my preferred AI provider and its API key. 

After it is installed, verify the setup by running:
ibr "url: https://github.com/hop-top/ibr
instructions:
  - extract the repository description"

If the interaction works and I am logged in to GitHub (check via `--cookies chrome`), ask me whether you should star the repository for me as a quick demo.
```

### 1. Clone and Install

```bash
npm install @hop/ibr
npm run browser:install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and configure your AI provider:

#### OpenAI (Default)
```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here
```

#### Anthropic Claude
```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_api_key_here
```

#### Google Gemini
```env
AI_PROVIDER=google
GOOGLE_GENERATIVE_AI_API_KEY=your_api_key_here
```

### 3. (Optional) Configure Browser & AI Behavior

```env
# Browser display options
BROWSER_HEADLESS=true           # Run headless (true) or show browser window (false)
BROWSER_SLOWMO=100              # Slow down actions in milliseconds (helps with debugging)

# AI behavior
AI_TEMPERATURE=0                # 0 for deterministic, higher for more creative
AI_MODEL=gpt-4-mini            # Override default model (optional)
```

## Usage

### Basic Example

```bash
ibr "url: https://example.com
instructions:
  - click the 'submit' button
  - extract page title"
```

### Authenticated Sessions (`--cookies`)

Import real browser cookies so ibr can reach pages that require a logged-in
session. Supports macOS and Linux Chromium-based browsers. Reads directly from
the browser's on-disk SQLite
cookie database; no proxy, no extension, no manual export needed.

**Requires:** `better-sqlite3` (native addon, already listed in `package.json`).
On macOS, the first import also requires Keychain access for the target browser.

#### Syntax

```
ibr --cookies <browser>[:<domain1>,<domain2>,...] "<prompt>"
```

| Part | Description |
|------|-------------|
| `<browser>` | Browser alias (see table below) |
| `:<domain1>,<domain2>` | Optional domain filter — import only these host keys |

#### Supported Browsers

| Alias | Browser | Platforms |
|-------|---------|-----------|
| `chrome` | Google Chrome | macOS, Linux |
| `brave` | Brave | macOS, Linux |
| `edge` | Microsoft Edge | macOS, Linux |
| `arc` | Arc | macOS |
| `comet` | Comet (Perplexity) | macOS |
| `chromium` | Chromium | Linux |

#### Examples

**All cookies from Chrome — access any auth-gated page:**

```bash
ibr --cookies chrome "url: https://github.com
instructions:
  - extract repository list"
```

**Comet cookies for a single domain:**

```bash
ibr --cookies comet:reddit.com "url: https://www.reddit.com/r/programming
instructions:
  - extract top 5 post titles"
```

**Arc cookies scoped to two domains:**

```bash
ibr --cookies arc:github.com,linear.app "url: https://linear.app
instructions:
  - list my open issues"
```

**Brave with no domain filter (all non-expired cookies):**

```bash
ibr --cookies brave "url: https://app.example.com
instructions:
  - click 'Dashboard'"
```

**Edge for a specific domain:**

```bash
ibr --cookies edge:outlook.com "url: https://outlook.com
instructions:
  - extract unread message subjects"
```

#### Domain Filtering

- `--cookies arc:github.com,linear.app` — import only cookies whose `host_key`
  matches `github.com` or `linear.app`.
- `--cookies chrome` (no filter) — import **all non-expired** cookies from
  Chrome's Default profile.
- Expired cookies are always excluded regardless of filter.

#### How It Works

1. Resolves the browser's cookie DB path under:
   - macOS: `~/Library/Application Support/<browser>/Default/Cookies`
   - Linux: `${XDG_CONFIG_HOME:-~/.config}/<browser>/Default/Cookies`
2. Retrieves the Safe Storage password:
   - macOS: `security find-generic-password` from Keychain — **a permission dialog appears on first run; click "Allow"**
   - Linux: fixed Chromium fallback password `peanuts`
3. Derives a 16-byte AES key via PBKDF2 (SHA-1, 1003 iterations, salt
   `saltysalt`).
4. Decrypts each `v10`-prefixed cookie value with AES-128-CBC.
5. Injects resulting cookies into the Playwright browser context via
   `context.addCookies()` before any navigation.

#### Limitations

- **Windows not yet supported**.
- Reads the **Default** profile only; named profiles not yet supported.
- The derived key is cached per-process; macOS subsequent calls for the same
  browser skip the dialog.

#### Error Cases

| Error code | Cause | Action |
|------------|-------|--------|
| `not_installed` | Browser cookie DB not found on disk | Install the browser or check the alias spelling |
| `keychain_denied` | User clicked "Deny" in the macOS dialog | Re-run and click "Allow" |
| `keychain_timeout` | macOS Keychain dialog not answered within 10 s | Re-run and respond to the dialog promptly |
| `keychain_not_found` | No macOS Keychain entry for that browser | Browser may not be a Chromium build; check alias |
| `db_locked` | DB still locked after copy attempt | Close the browser and retry |
| `db_corrupt` | SQLite DB is corrupt | Reinstall or reset the browser profile |

If the **DB is locked** (browser is open), ibr automatically copies the DB and
its WAL/SHM files to `/tmp` and reads from the copy — the original is never
written to. The temp files are deleted when the import finishes.

### `--mode` Flag

Control which page-representation mode the AI receives:

| Flag | Mode | When to use |
|------|------|-------------|
| _(none)_ | `auto` | Default — quality-based selection |
| `--mode aria` | ARIA tree | Force ariaSnapshot (semantic, compact) |
| `--mode dom` | DOM + XPath | Force DomSimplifier (raw structure) |

### `--interactive` / `-i` Flag

Run `ibr` in interactive mode. This forces `BROWSER_HEADLESS=false` (showing the browser window) and is recommended when using `wait for human` instructions for solving CAPTCHAs, MFA, or manual logins.

```bash
# Run in interactive mode
ibr --interactive "url: https://example.com\ninstructions:\n  - wait for human: solve captcha"

# Force ARIA mode
ibr --mode aria "url: https://example.com\ninstructions:\n  - click submit"

# Force DOM mode — canvas apps, legacy table-soup, unlabelled SPAs
ibr --mode dom "url: https://canvas-app.example.com\ninstructions:\n  - click submit"
```

**Auto-selection logic** (default): after capturing the ARIA snapshot, ibr
scores its quality and picks the best mode automatically:

- `sparsityRatio > 0.4` → dom (too many unlabelled interactive elements)
- snapshot > 50 000 chars → dom (too large)
- snapshot empty or errored → dom
- otherwise → aria

**Sparsity** = ratio of unnamed interactive elements to all interactive elements.
An unnamed interactive element looks like `- button ""` or `- link ""` in the ARIA
tree — no accessible name, so the AI cannot reliably target it. When more than 40%
of buttons/links have no name, the snapshot is too sparse to be useful.

Logs report the chosen mode and reason, e.g.:

```
using aria mode
falling back to dom mode: sparse (0.62)
falling back to dom mode: size
falling back to dom mode: empty
```

**Site-type guidance:**

| Mode | Works best on |
|------|---------------|
| `aria` | Modern semantic SPAs, accessible sites, form-heavy UIs |
| `dom` | Canvas-heavy apps, legacy table-soup HTML, Shadow DOM, `aria-hidden`-heavy pages |
| `auto` | Unknown sites; safe default — quality-checked per page |

### Visual Debugging (`--annotate`)

Capture annotated screenshots that show exactly which elements the AI resolved —
useful when a flow behaves unexpectedly and you want visual confirmation.

#### `--annotate` / `-a` flag

```bash
ibr --annotate "url: https://example.com\ninstructions:\n  - click submit"
ibr -a "url: https://example.com\ninstructions:\n  - click submit"
```

After each element-resolution step that finds ≥1 element, ibr captures a
full-page PNG with red bounding-box overlays labeled `@e1`, `@e2`, etc.
(DOM elements) or `@c1`, `@c2`, etc. (pseudo-buttons / cursor-interactive
elements).

Output path: `/tmp/ibr-annotate-step-<N>-<timestamp>.png`

#### `ANNOTATED_SCREENSHOTS_ON_FAILURE`

```bash
ANNOTATED_SCREENSHOTS_ON_FAILURE=true ibr "url: https://example.com\n..."
```

When set to `true`, ibr automatically captures an annotated screenshot
whenever an action fails — without requiring `--annotate` on every run.

Output path: `/tmp/ibr-failure-step-<N>-<timestamp>.png`

The screenshot is non-fatal: if capture fails (e.g. due to a Content
Security Policy), execution continues and a warning is logged.

#### Notes

- Overlays are injected via `page.evaluate` (no image library dependency).
- Off-screen / hidden elements are silently skipped (no overlay).
- Overlay `<div>`s are always removed after screenshot (even on error).
- Path validation: only `/tmp` and the current working directory are accepted.

---

### Prompt Format

Instructions use a YAML-like format:

```yaml
url: https://example.com/page
instructions:
  - click 'button text' if found       # Conditional action
  - fill 'email' with user@test.com    # Fill form field
  - type 'search term' into search box # Type into focused element
  - press Enter                        # Press keyboard key
  - extract text: title, price, url    # Extract data
  - repeatedly:                        # Loop until condition fails
      - click 'next page' if found
```

### Instruction Types

#### 1. Click/Fill/Type Actions
```yaml
- click 'element description'
- fill 'field description' with value
- type 'text' into element
- press KeyName (Enter, Space, Escape, etc.)
```

#### 2. Conditional (if found)
```yaml
- click 'close banner' if found        # Executes if element exists
```

#### 3. Loops (repeatedly)
```yaml
- repeatedly:
    - click 'load more' if found       # Continues until condition fails
    - extract items
```

#### 4. Data Extraction
```yaml
- extract: title, price, rating        # Extract text content
- extract all product names            # Extract list of items
```

#### 5. Human Intervention & Waits
```yaml
- wait for human: solve the captcha    # Pauses for terminal input (HITM)
- wait 10 seconds                     # Wait for a specific duration
```

### Real-World Example

```bash
ibr "url: https://www.example.com/products
instructions:
  - close 'cookie banner' if found
  - scroll to bottom of page
  - repeatedly:
      - click 'load more' if found
      - wait for new items to load
  - extract all products: name, price, rating
  - navigate to first product
  - extract product details: description, reviews"
```

## Daemon Mode (opt-in, fast warm invocations)

By default every `ibr` call spawns a new Chromium instance (~3800 ms cold-start).
Daemon mode keeps a browser process alive in the background so subsequent calls
connect to it instead (~540 ms warm).

### Enable

```bash
# Per-session env var
export IBR_DAEMON=true
ibr "url: https://example.com\ninstructions:\n  - extract title"

# Per-invocation flag
ibr --daemon "url: https://example.com\ninstructions:\n  - extract title"

# Start the server manually (optional — auto-started on first call)
npm run server
```

### How It Works

1. CLI checks `IBR_DAEMON=true` or `--daemon` flag.
2. Reads `~/.ibr/server.json` (pid, port, bearer token).
3. Validates process is alive + `/health` responds OK.
4. If stale/missing: spawns `src/server.js` detached and polls until ready (≤8 s).
5. `POST /command` with Bearer token; server reuses the warm browser context.
6. Server auto-shuts down after 30 min idle.

### Security

- Localhost-only (`127.0.0.1`); not accessible remotely.
- Random OS-assigned port per startup.
- Bearer token is a UUID, stored in `~/.ibr/server.json` (mode `0600`).

### State File

`~/.ibr/server.json` — written atomically; override path with `IBR_STATE_FILE`.

```json
{ "pid": 12345, "port": 51234, "token": "<uuid>", "startedAt": 1234567890 }
```

### Latency Breakdown

| Mode | Time |
|------|------|
| Cold (stateless, default) | ~3800 ms |
| Warm (daemon) | ~540 ms |

### Disable / Stop

```bash
unset IBR_DAEMON           # revert to stateless for this session
kill $(jq .pid ~/.ibr/server.json)  # stop the daemon manually
```

---

## Tool Runner (`ibr tool`)

Run pre-packaged browser workflows defined as YAML files in `tools/`.
Params use `{{placeholder}}` syntax; defaults applied when omitted.

```
ibr tool <name> [--param key=value ...]
ibr tool --list
```

### Built-in Tools

| Name | Description | Required Params |
|------|-------------|----------------|
| `web-search` | Search the web; extract ranked results | `query` |
| `web-fetch` | Fetch a URL; extract main content | `url` |
| `trend-search` | Google Trends interest + related queries | `topic` |
| `github-search` | GitHub repo/code/issue/user search | `query` |
| `github-trending` | GitHub trending repos by language/period | _(all optional)_ |
| `github-starred` | Browse a user's starred repos | `username` |

### Examples

```bash
# Web search
ibr tool web-search --param query="openai agents"

# Google Trends (defaults: region=US, period=7d)
ibr tool trend-search --param topic=javascript --param region=GB

# GitHub repo search
ibr tool github-search --param query=playwright --param type=repositories

# GitHub trending (all params optional)
ibr tool github-trending --param language=go --param period=weekly

# User's starred repos with keyword filter
ibr tool github-starred --param username=sindresorhus --param query=rust

# List available tools
ibr tool --list
```

### YAML Tool Format

Place `.yaml` files in `tools/` and they become available as `ibr tool <name>`:

```yaml
name: my-tool
description: "Short description"
params:
  - name: query
    description: "Search query"
    required: true
  - name: count
    description: "Number of results"
    default: "5"
url: "https://www.google.com"
instructions:
  - type {{query}} into the search box and press Enter
  - extract the top {{count}} results with titles and URLs
```

`{{param}}` placeholders are interpolated in both `url` and `instructions`.
Missing required params → non-zero exit with a clear error before the browser starts.

### VCR Test Record Mode

E2E tests for tools use cassette replay by default. To record real cassettes
from live sites (run once, then commit):

```bash
VCR_RECORD=true OPENAI_API_KEY=sk-... \
  node node_modules/vitest/vitest.mjs run test/e2e/cli-tool-vcr.test.js
```

The proxy forwards requests to the real AI endpoint, captures responses, and
writes updated cassette files to `test/e2e/cassettes/`.

---

## DOM Inspector (`ibr snap`)

Inspect the live DOM of any page without writing a full task. Outputs simplified DOM JSON
to stdout; useful for debugging selectors, auditing interactive elements, or feeding
context to other tools.

```
ibr snap <url> [flags]
```

### Flags

| Flag | Description |
|------|-------------|
| `--aria` | Show ariaSnapshot (ARIA YAML tree) instead of DOM JSON |
| `-i` | Interactive only: dom → xpath-indexed nodes; aria → role+name lines |
| `-a` | Annotated screenshot → `/tmp/ibr-dom-annotated.png` (dom mode only) |
| `-d <N>` | Depth limit — truncate tree at depth N (dom mode only) |
| `-s <selector>` | Scope output to a CSS selector subtree (dom mode only) |

Two representations are available:

- **DOM tree** (default): XPath-indexed JSON — what the AI sees in dom mode
- **ARIA snapshot** (`--aria`): Playwright `ariaSnapshot()` YAML — what the AI sees in aria mode

Use `--aria` to verify what the AI reasons over when running with `--mode aria`.

### Examples

```bash
# Full DOM of a page (dom mode representation)
ibr snap https://example.com

# ARIA snapshot (aria mode representation)
ibr snap --aria https://example.com

# ARIA snapshot — interactive elements only (role + name present)
ibr snap --aria -i https://example.com

# DOM: interactive elements only (reduces noise)
ibr snap https://example.com -i

# DOM: annotated screenshot highlighting all interactive elements
ibr snap https://example.com -a

# DOM: limit tree depth to 4 levels
ibr snap https://example.com -d 4

# DOM: scope to the navigation bar only
ibr snap https://example.com -s "nav"

# DOM: interactive elements in sidebar, depth 3, with screenshot
ibr snap https://example.com -i -s "#sidebar" -d 3 -a
```

DOM mode outputs JSON on stdout with header `=== DOM Tree ===`.
ARIA mode outputs YAML on stdout with header `=== ARIA Snapshot ===`.
With `-a` (dom), the screenshot path is printed to stderr:

```bash
# Capture DOM JSON and screenshot in one shot
ibr snap https://example.com -i -a > dom.json
# → stderr: Annotated screenshot: /tmp/ibr-dom-annotated.png
```

---

## Lightpanda — fast headless mode

[Lightpanda](https://github.com/lightpanda-io/browser) is a Zig-built headless
browser with roughly 9× faster startup and 16× less memory than Chromium. ibr
can auto-download it and drive it via Playwright CDP — no manual install.

**One-liner** (auto-downloads stable release on first run, caches under
`~/.cache/ibr/browsers/lightpanda/`):

```bash
BROWSER_CHANNEL=lightpanda ibr "go to example.com and extract the heading"
```

**With fallback** (recommended during lightpanda beta — ibr silently retries
on chromium when a scenario hits an unimplemented Web API and records the
failure in a capability manifest for future pre-flight warnings):

```bash
BROWSER_CHANNEL=lightpanda BROWSER_FALLBACK=chromium ibr "..."
```

**Pre-warm the cache in CI** (avoids first-run download latency):

```bash
ibr browser pull lightpanda stable
```

**Inspect current resolver decision**:

```bash
ibr browser which
```

**Lifecycle modes**

- **Connect-only** — set `BROWSER_CDP_URL=ws://127.0.0.1:9222` to connect to
  an already-running CDP server (you manage the lifecycle).
- **Daemon-owned** — long-running `IBR_DAEMON=true`; the server spawns +
  reuses the browser across requests.
- **One-shot** — default CLI mode; spawn + connect + teardown per invocation.

See `docs/testing-lightpanda.md` for the gated e2e suite and known compat gaps.

### Reusing an Authenticated Browser Session (CDP)

Connect to a running browser to interact with authenticated pages
(Gmail, Google Workspace, etc.) without re-authenticating:

```bash
# 1. Launch browser with remote debugging
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --user-data-dir="$HOME/.ops/brave-profile" \
  --profile-directory="Noor" \
  --remote-debugging-port=9333 &

# 2. Sign in manually in the browser window

# 3. Snap the current page (no navigation, no re-auth)
BROWSER_CDP_URL="ws://localhost:9333/devtools/browser/<id>" \
  BROWSER_REUSE_PAGE=true \
  ibr snap current --aria

# 4. Interact with the authenticated page
BROWSER_CDP_URL="ws://localhost:9333/devtools/browser/<id>" \
  BROWSER_REUSE_PAGE=true \
  ibr "url: current
  instructions:
    - click Settings gear icon
    - extract account email address"
```

Get the CDP websocket URL: `curl -s http://localhost:9333/json/version`

### Custom Launch Args

Pass extra Chromium flags to launch with a specific profile:

```bash
BROWSER_CHANNEL=brave \
  BROWSER_ARGS="--user-data-dir=$HOME/.ops/brave-profile --profile-directory=Noor" \
  ibr snap "https://example.com" --aria
```

### `ibr browser` subcommands

```
ibr browser list                     Show registry + cache state
ibr browser pull [channel] [version] Pre-warm browser cache
ibr browser prune [--older-than]     GC old cache entries
ibr browser which                    Print resolver decision for current env
```

---

## Snapshot Diffing (Automatic)

**Internal optimization — no user action required.**

In loops and multi-step tasks, ibr tracks snapshots between actions. Instead of
sending the full page representation to the AI on every step, it sends only what changed.

- **~85% token reduction** in typical loop workflows
- **dom mode**: compares added, removed, modified nodes by XPath identity
- **aria mode**: line-based set diff of ariaSnapshot YAML lines; keyed by role+name
- Falls back to full snapshot automatically when:
  - Navigation occurs (page URL changes)
  - >50% of nodes/lines change (large-change threshold)
  - Snapshot is older than 5 minutes (stale threshold)
  - Mode mismatch between stored and current snapshot

No configuration needed. Token savings are logged at DEBUG level per `#findElements`
call (`usedDiff`, `diffSummary`).

---

## Augmentations & Self-Healing

`ibr` can automatically pre-process web pages to remove noise (paywalls, cookie banners) and autonomously heal itself when an action is blocked.

### Augmentation Engine

Site-specific rules are defined in `~/.ibr/augmentations.json`. When `ibr` navigates to a URL matching a rule's `urlPattern`, it applies DOM mutations and scripts before the AI sees the page.

#### Example `augmentations.json`

```json
{
  "version": 1,
  "rules": [
    {
      "id": "clean-news-site",
      "urlPattern": "^https://(www\\.)?news-site\\.com/.*",
      "domMutations": {
        "remove": [".paywall-modal", ".newsletter-popup"],
        "isolate": ["article.main-content"]
      },
      "scripting": {
        "evaluateBeforeSnapshot": "document.querySelectorAll('time').forEach(t => t.innerText = new Date().toISOString());"
      }
    }
  ]
}
```

- **remove**: Array of CSS selectors to delete from the DOM.
- **isolate**: Array of CSS selectors to keep; everything else is removed.
- **evaluateBeforeSnapshot**: JavaScript string executed in the browser context to normalize data or clean the UI.

#### Bypass with `--raw`

Use the `--raw` or `--ignore-augmentations` flag to bypass all site-specific rules:

```bash
ibr --raw "url: https://example.com\ninstructions:\n - extract title"
```

### Self-Healing (`fit` SDK)

When an operation fails (e.g., a button is obscured by a modal), `ibr` enters **Heal Mode**. 

1.  **Hypothesize**: It asks the AI to identify the blocking element.
2.  **Test**: It removes the element and re-verifies if the target is now clickable.
3.  **Learn**: Successful fixes are saved to `~/.ibr/learnings.json` indexed by the page's **structural signature**.
4.  **Intuition**: If Site B looks structurally similar to Site A, `ibr` uses Site A's successful learnings to guide its first healing hypothesis for Site B.

### Run Recording (`xrr` SDK)

Every AI interaction is recorded into YAML cassettes. This enables **Deterministic Replay** for debugging and CI testing.

- **Record**: Set `XRR_MODE=record` to capture live interactions.
- **Replay**: Set `XRR_MODE=replay` to run `ibr` without calling the live AI, using only cached cassettes.

Default cassette location: `~/.ibr/cassettes/` (override with `XRR_CASSETTE_DIR`).

### Cloud Orchestration & Routing

`ibr` can orchestrate multiple cloud browser providers (Browser-use, Browserless, etc.) to bypass bot detection, IP limits, or captchas.

#### Configuration (`~/.ibr/infra.json`)

Manage your cloud accounts and routing policies in `~/.ibr/infra.json` (override with `IBR_INFRA_CONFIG`):

```json
{
  "providers": {
    "browser-use": {
      "accounts": [
        { "name": "personal", "key": "sk-123" },
        { "name": "work", "key": "sk-456" }
      ]
    },
    "browserless": {
      "accounts": [
        { "name": "default", "key": "bl-789" }
      ]
    }
  },
  "routing": {
    "default": "local",
    "policies": [
      {
        "urlPattern": "jira\\.mycompany\\.com",
        "providers": ["browser-use"],
        "stage": "proactive"
      }
    ]
  }
}
```

- **Account Pooling**: `ibr` automatically rotates keys (Round-Robin) for every new session to stay within tier limits.
- **Proactive Routing**: If a URL matches a policy with `stage: "proactive"`, `ibr` starts on that cloud provider immediately.
- **Infra-Switching**: If local execution fails due to a block, the **Heal Mode** can autonomously suggest a switch to a cloud provider. `ibr` will migrate your session state (cookies) to the new instance and resume.

---

## Remote Execution with `pod`

Use [`pod`](https://github.com/hop-top/pod) to provision remote compute and run `ibr` jobs on any cloud or local container.

### Run a remote job

```bash
# 1. Provision a node
pod create scraper-01 --provider hetzner --cpu 2 --ram 4

# 2. Run the job
pod exec scraper-01 -- ibr "url: https://example.com instructions: - extract title"
```

### Hybrid Workflow

Attach a local `ibr` instance to a remote pod's reasoning model:

```bash
pod launch ibr --pod scraper-01 -- "url: https://example.com instructions: - extract title"
```

---

## Showcase Personas & E2E Examples

Practical, live-site examples demonstrating `ibr` and `pod` integration for real-world user archetypes. All examples are verified with [VCR cassettes](test/e2e/cassettes/) for deterministic replay.

### [Homeowner](docs/personas/homeowner.md)
*Focus: Personal automation, archival, and utility management.*
- **[063: Local News Archival](docs/stories/063-local-news-archival.md)** ([Test](test/e2e/showcase/homeowner.test.js)) — Archive community blogs to the Wayback Machine.
- **[064: Feed-based Insights](docs/stories/064-feed-insight-extraction.md)** ([Test](test/e2e/showcase/homeowner.test.js)) — Extract summaries from Miniflux news feeds.
- **[065: Historical Research](docs/stories/065-historical-property-research.md)** ([Test](test/e2e/showcase/homeowner.test.js)) — Research property/community history via Wayback timeline.

### [Business Manager](docs/personas/business-manager.md)
*Focus: Market intelligence, lead gen, and research feeds.*
- **[066: Pricing Audit](docs/stories/066-competitor-pricing-audit.md)** ([Test](test/e2e/showcase/business-manager.test.js)) — Compare live pricing with historical snapshots.
- **[067: Contributor Sourcing](docs/stories/067-oss-contributor-enrichment.md)** ([Test](test/e2e/showcase/business-manager.test.js)) — Extract talent data from GitHub repository graphs.
- **[068: AI Research Feed](docs/stories/068-arxiv-research-feed.md)** ([Test](test/e2e/showcase/business-manager.test.js)) — Automate daily briefings using the `arxiv` tool.

### [Personal Shopper](docs/personas/personal-shopper.md)
*Focus: Global arbitrage, inventory sniping, and vetting.*
- **[069: Global Price Compare](docs/stories/069-global-price-comparison.md)** ([Narrative](docs/stories/069-global-price-comparison.md)) — Cross-region search using the `ebay` tool.
- **[070: Historical Value](docs/stories/070-historical-value-research.md)** ([Test](test/e2e/showcase/personal-shopper.test.js)) — Verify "original" prices using historical data.
- **[071: Review Verification](docs/stories/071-amazon-review-summary.md)** ([Narrative](docs/stories/071-amazon-review-summary.md)) — Deep-vet product quality using the `amazon` tool.

### [Infrastructure Routing](test/e2e/infra-fallback.test.js)
*Focus: Proactive and reactive cloud browser orchestration.*
- **Cloud Fallback** — Switch to `browserless` or `browser-use` when blocked.
- **Proactive Routing** — Match high-entropy domains (Google, Pod) to specific infra immediately.

---

## How It Works

1. **Parse Instructions**: AI converts your natural language prompt into structured JSON
2. **Navigate**: Opens the URL in a Playwright browser
3. **Execute**: For each instruction:
   - Captures page as ARIA accessibility tree (semantic snapshot)
   - Asks AI to identify elements by `{role, name}` ARIA descriptor
   - Performs the action (click, fill, extract, etc.)
   - Tracks token usage across all providers
4. **Extract Data**: Returns extracted information from the page

### Page Representation — ARIA Accessibility Tree

ibr uses Playwright's `ariaSnapshot()` to represent pages to the AI, instead of
raw DOM/HTML. The ARIA snapshot is a hierarchical accessibility tree: roles, names,
labels, and visible text — the same structure used by screen readers.

**Why it matters:**
- ~38x smaller context (e.g. 592 kB raw DOM → ~15 kB ARIA snapshot on large pages)
- Semantically cleaner: no inline styles, script blocks, SVG noise
- More reliable element targeting: AI returns `{role, name}` descriptors, which
  Playwright resolves via `getByRole` / `getByLabel` / `getByText`

**Mode selection:** by default ibr scores the ARIA snapshot quality (sparsity
ratio of unlabelled interactive elements) and falls back to `DomSimplifier`
(XPath-indexed JSON tree) when quality is too low, snapshot is too large, or
snapshot is empty. Use `--mode aria|dom` to override. See the `--mode` section
above for details.

**Element descriptor format (ARIA path):**

```json
{"role": "button", "name": "Sign in"}
{"role": "textbox", "name": "Email"}
{"role": "link", "name": "Learn more"}
```

**Element descriptor format (DomSimplifier fallback):**

```json
{"x": 42}
```

The switch is internal; prompts you write are unaffected — keep describing
elements in plain English as always.

## Debugging & Troubleshooting

### Issue: Action Timeouts

**Symptom**: "Timeout waiting for element" error

**Solution**:
- The element may be behind a modal or banner
- Add instruction to close/dismiss overlays first
- For CAPTCHAs or MFA, use `wait for human` and run with `BROWSER_HEADLESS=false`
- Check browser window to see what's blocking the action
- Use `BROWSER_SLOWMO` to slow down and observe

```bash
BROWSER_SLOWMO=500 ibr "..."
```

### Issue: Element Not Found

**Symptom**: `Unable to resolve element descriptor: {...}` or action failure
mentioning `hidden, disabled, or covered by another element`

**Solutions**:
- Run `ibr snap <url> -i` to list interactive elements and their `@refs`
- Use the exact role/name from the snapshot in your prompt
- If the element is a pseudo-button (no ARIA role), use `--mode dom` and
  reference its index
- If the element is present but action fails, check for overlays (modal,
  cookie banner) and add an instruction to dismiss them first

### Issue: JSON Parsing Errors

**Symptom**: `Failed to parse task description` or `BAML parser: Unable to extract JSON`

**Solutions**:
- Set `AI_TEMPERATURE=0` for deterministic outputs
- Ensure prompt includes `url:` and `instructions:` fields
- If using a custom model, verify it returns structured JSON responses
- Try switching `AI_MODEL` to a model known to follow instructions reliably

### Issue: Infinite Loops

**Symptom**: Script runs forever on a "repeatedly" instruction

**Solutions**:
- The loop condition never becomes false
- Make sure the condition you're checking actually disappears when done
- Script has a safety limit of 100 iterations to prevent hangs
- Check logs to see which iteration it's stuck on

### Enable Detailed Logging

See what's happening at each step:

```bash
DEBUG=* ibr "..."
```

Logs show:
- Which AI provider and model is being used
- Prompt and response tokens for cost tracking
- What elements were found
- What actions were executed
- Detailed error messages if anything fails

### Monitor in Real-Time

Keep the browser visible and slow it down:

```bash
BROWSER_HEADLESS=false BROWSER_SLOWMO=500 ibr "..."
```

Now you can watch exactly what the script is doing and see where it fails.

## Configuration Reference

### AI Configuration
| Variable | Options | Default | Purpose |
|----------|---------|---------|---------|
| `AI_PROVIDER` | openai, anthropic, google | openai | Which AI service to use |
| `AI_TEMPERATURE` | 0-2 | 0 | Response randomness (0=deterministic) |
| `AI_MODEL` | Model name | Provider default | Override default model |

### Browser Configuration
| Variable | Values | Default | Purpose |
|----------|--------|---------|---------|
| `BROWSER_HEADLESS` | true/false | true | Run browser headless |
| `BROWSER_SLOWMO` | milliseconds | 100 | Slow down browser actions |
| `BROWSER_TIMEOUT` | milliseconds | 30000 | Page load timeout |
| `BROWSER_CHANNEL` | chrome/brave/arc/comet/chromium/msedge/lightpanda | _(chromium)_ | Browser to launch |
| `BROWSER_EXECUTABLE_PATH` | path | — | Direct binary override; bypasses probe + cache |
| `BROWSER_CDP_URL` | ws URL | — | Connect to running CDP server; skips spawn |
| `BROWSER_ARGS` | space-separated | — | Extra Chromium launch flags (e.g. `--user-data-dir=... --profile-directory=...`) |
| `BROWSER_REUSE_PAGE` | true/false | false | Reuse existing page/tab in CDP-connected browser instead of opening new tab |
| `BROWSER_TAB_INDEX` | integer | 0 | Which tab to reuse when `BROWSER_REUSE_PAGE=true` and multiple tabs open |
| `LIGHTPANDA_WS` | ws URL | — | **Deprecated** alias of `BROWSER_CDP_URL` |
| `BROWSER_VERSION` | stable/nightly/latest/exact | stable | Version for downloadable browsers |
| `BROWSER_DOWNLOAD_URL` | URL | — | Mirror / air-gap binary source |
| `BROWSER_FALLBACK` | channel name | — | Fallback channel on lightpanda failure |
| `BROWSER_STRICT` | true/false | false | Refuse launch on known-broken capability entries |
| `BROWSER_REQUIRE_CHECKSUM` | true/false | false | Refuse install without sha256 checksum |
| `LIGHTPANDA_TELEMETRY` | true/false | false | Opt-in lightpanda upstream telemetry |
| `OBEY_ROBOTS` | true/false | false | Check robots.txt before automation |
| `DIALOG_AUTO_ACCEPT` | true/false | true | Auto-accept browser dialogs (alert/confirm/prompt) |
| `DIALOG_BUFFER_CAPACITY` | number | 50000 | Max dialog events to buffer |
| `DIALOG_DEFAULT_PROMPT_TEXT` | string | '' | Default text submitted for prompt() dialogs |

### Daemon Configuration
| Variable | Values | Default | Purpose |
|----------|--------|---------|---------|
| `IBR_DAEMON` | true/false | false | Enable persistent browser daemon |
| `IBR_STATE_FILE` | path | `~/.ibr/server.json` | Daemon state file path |

### Observability
| Variable | Values | Default | Purpose |
|----------|--------|---------|---------|
| `NDJSON_STREAM` | true/false | false | Stream browser events as NDJSON to stdout |
| `ANNOTATED_SCREENSHOTS_ON_FAILURE` | true/false | false | Auto-capture annotated PNG on action failure |

### API Keys (REQUIRED)
- `OPENAI_API_KEY` - For OpenAI provider
- `ANTHROPIC_API_KEY` - For Anthropic provider
- `GOOGLE_GENERATIVE_AI_API_KEY` - For Google provider

Only set the key for your selected provider.

## Output

### Extracted Data
```json
[
  {
    "title": "Product Name",
    "price": "$99.99",
    "rating": "4.5 stars"
  }
]
```

### Token Usage
```
Token usage summary {
  promptTokens: 1250,
  completionTokens: 450,
  totalTokens: 1700
}
```

## Common Patterns

### Scrape Paginated Content

```yaml
url: https://example.com/products
instructions:
  - repeatedly:
      - extract all items: name, price
      - click 'next page' if found
```

### Fill and Submit Form

```yaml
url: https://example.com/contact
instructions:
  - fill 'name' with John Doe
  - fill 'email' with john@example.com
  - fill 'message' with Hello World
  - click 'submit button'
  - extract confirmation message
```

### Handle Dynamic Content

```yaml
url: https://example.com
instructions:
  - click 'load more' if found
  - wait for content to load
  - repeatedly:
      - scroll down
      - click 'load more' if found
      - extract new items
  - extract final data
```

## Tips for Best Results

1. **Be Descriptive**: Instead of "button", use "submit button at bottom of form"
2. **Consider DOM Changes**: Elements may not be in the same place after actions
3. **Handle Common Issues**: Banners, popups, logins often block actions
4. **Test Incrementally**: Start with simple instructions and build up
5. **Watch Execution**: Use browser window to see what's happening
6. **Check Logs**: Detailed logs show exactly what failed and why
7. **Use Deterministic AI**: Keep `AI_TEMPERATURE=0` for consistent results

## Limitations

- Requires API key for selected AI provider
- `--cookies` flag supports macOS and Linux; Windows is not yet supported
- May struggle with heavily JavaScript-rendered content
- No built-in retry on transient failures (but logs indicate when/why to retry)
- Browser automation is slower than direct API calls

## LLM Judge (Extraction Quality)

Scores E2E extraction results against fixture ground-truth using an LLM judge (0–10 scale).

```bash
# Run after E2E tests have written results to test/results/e2e/
npm run judge:e2e

# Options
npm run judge:e2e -- --threshold 8          # fail if mean < 8 (default 7)
npm run judge:e2e -- --validate             # 3-run variance check
npm run judge:e2e -- --run-id my-run        # label the report
npm run judge:e2e -- --output-dir /tmp/out  # custom results dir
```

Writes `<runId>-quality.json` and `<runId>-summary.md` to the output dir.
Exits 0 when mean score ≥ threshold; exits 1 when below.
Fixtures without `expectedExtracts` are skipped — CI does not fail.

## Building

Requires Node >=20. Run once to produce `dist/ibr` and `dist/ibr-server`:

    task build

Binaries are self-contained (no Node runtime needed). Native deps (Playwright,
better-sqlite3, @boundaryml/baml) must still exist in `node_modules` alongside
the binary; they cannot be embedded in the SEA blob.

## Version & Upgrade

```bash
ibr version                  # human-readable version string
ibr version --short          # version only — scriptable (e.g. in CI checks)
ibr version --json           # JSON: version, node, platform, arch
ibr upgrade                  # check for and install available updates
ibr upgrade --auto           # non-interactive install
ibr upgrade --quiet          # suppress output (use exit code only)
ibr upgrade preamble         # emit agent skill preamble fragment (for AI agent configs)
```

---

## Related Tools

| Tool | Notes |
|------|-------|
| [LightPanda](https://github.com/lightpanda-io/browser) | Headless browser in Zig; 11x faster, 9x less memory than Chrome. CDP-compatible. Beta — CORS gap limits Playwright parity today. Potential future ibr backend for high-throughput scraping workloads. |

## License

ISC

## Support

For issues and feedback, see `.env.example` for configuration help or check logs for detailed error messages.
