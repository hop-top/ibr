# idx - Intent Driven eXtractor

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
- **DOM Inspector**: `idx snap` subcommand for on-demand page inspection
- **Daemon Mode**: Optional persistent browser server; warm invocations ~540ms vs ~3800ms cold
- **Visual Debugging**: `--annotate` / `-a` flag captures annotated PNGs with labeled bounding boxes
- **Failure Screenshots**: `ANNOTATED_SCREENSHOTS_ON_FAILURE=true` auto-captures on action failure
- **Comprehensive Logging**: Detailed execution logs for debugging
- **NDJSON Streaming**: `NDJSON_STREAM=true` emits structured browser events for pipeline integration

## Setup

### 1. Clone and Install

```bash
npm install @hop/idx
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
BROWSER_HEADLESS=false          # Show browser window (false) or run headless (true)
BROWSER_SLOWMO=100              # Slow down actions in milliseconds (helps with debugging)

# AI behavior
AI_TEMPERATURE=0                # 0 for deterministic, higher for more creative
AI_MODEL=gpt-4-mini            # Override default model (optional)
```

## Usage

### Basic Example

```bash
idx "url: https://example.com
instructions:
  - click the 'submit' button
  - extract page title"
```

### Authenticated Sessions (`--cookies`)

Import real browser cookies so idx can reach pages that require a logged-in
session. **macOS only.** Reads directly from the browser's on-disk SQLite
cookie database; no proxy, no extension, no manual export needed.

**Requires:** `better-sqlite3` (native addon, already listed in `package.json`)
and macOS Keychain access for the target browser.

#### Syntax

```
idx --cookies <browser>[:<domain1>,<domain2>,...] "<prompt>"
```

| Part | Description |
|------|-------------|
| `<browser>` | Browser alias (see table below) |
| `:<domain1>,<domain2>` | Optional domain filter — import only these host keys |

#### Supported Browsers

| Alias | Browser |
|-------|---------|
| `comet` | Comet (Perplexity) |
| `chrome` | Google Chrome |
| `arc` | Arc |
| `brave` | Brave |
| `edge` | Microsoft Edge |

#### Examples

**All cookies from Chrome — access any auth-gated page:**

```bash
idx --cookies chrome "url: https://github.com
instructions:
  - extract repository list"
```

**Comet cookies for a single domain:**

```bash
idx --cookies comet:reddit.com "url: https://www.reddit.com/r/programming
instructions:
  - extract top 5 post titles"
```

**Arc cookies scoped to two domains:**

```bash
idx --cookies arc:github.com,linear.app "url: https://linear.app
instructions:
  - list my open issues"
```

**Brave with no domain filter (all non-expired cookies):**

```bash
idx --cookies brave "url: https://app.example.com
instructions:
  - click 'Dashboard'"
```

**Edge for a specific domain:**

```bash
idx --cookies edge:outlook.com "url: https://outlook.com
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

1. Resolves the browser's cookie DB path under
   `~/Library/Application Support/<browser>/Default/Cookies`.
2. Calls `security find-generic-password` to retrieve the Safe Storage key from
   macOS Keychain — **a permission dialog appears on first run; click "Allow"**.
3. Derives a 16-byte AES key via PBKDF2 (SHA-1, 1003 iterations, salt
   `saltysalt`).
4. Decrypts each `v10`-prefixed cookie value with AES-128-CBC.
5. Injects resulting cookies into the Playwright browser context via
   `context.addCookies()` before any navigation.

#### Limitations

- **macOS only** — no Windows or Linux support.
- Reads the **Default** profile only; named profiles not yet supported.
- Keychain key is cached per-process; subsequent calls for the same browser
  skip the dialog.

#### Error Cases

| Error code | Cause | Action |
|------------|-------|--------|
| `not_installed` | Browser cookie DB not found on disk | Install the browser or check the alias spelling |
| `keychain_denied` | User clicked "Deny" in the macOS dialog | Re-run and click "Allow" |
| `keychain_timeout` | Keychain dialog not answered within 10 s | Re-run and respond to the dialog promptly |
| `keychain_not_found` | No Keychain entry for that browser | Browser may not be a Chromium build; check alias |
| `db_locked` | DB still locked after copy attempt | Close the browser and retry |
| `db_corrupt` | SQLite DB is corrupt | Reinstall or reset the browser profile |

If the **DB is locked** (browser is open), idx automatically copies the DB and
its WAL/SHM files to `/tmp` and reads from the copy — the original is never
written to. The temp files are deleted when the import finishes.

### `--mode` Flag

Control which page-representation mode the AI receives:

| Flag | Mode | When to use |
|------|------|-------------|
| _(none)_ | `auto` | Default — quality-based selection |
| `--mode aria` | ARIA tree | Force ariaSnapshot (semantic, compact) |
| `--mode dom` | DOM + XPath | Force DomSimplifier (raw structure) |

```bash
# Force ARIA mode
idx --mode aria "url: https://example.com\ninstructions:\n  - click submit"

# Force DOM mode — canvas apps, legacy table-soup, unlabelled SPAs
idx --mode dom "url: https://canvas-app.example.com\ninstructions:\n  - click submit"
```

**Auto-selection logic** (default): after capturing the ARIA snapshot, idx
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
idx --annotate "url: https://example.com\ninstructions:\n  - click submit"
idx -a "url: https://example.com\ninstructions:\n  - click submit"
```

After each element-resolution step that finds ≥1 element, idx captures a
full-page PNG with red bounding-box overlays labeled `@e1`, `@e2`, etc.
(DOM elements) or `@c1`, `@c2`, etc. (pseudo-buttons / cursor-interactive
elements).

Output path: `/tmp/idx-annotate-step-<N>-<timestamp>.png`

#### `ANNOTATED_SCREENSHOTS_ON_FAILURE`

```bash
ANNOTATED_SCREENSHOTS_ON_FAILURE=true idx "url: https://example.com\n..."
```

When set to `true`, idx automatically captures an annotated screenshot
whenever an action fails — without requiring `--annotate` on every run.

Output path: `/tmp/idx-failure-step-<N>-<timestamp>.png`

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

### Real-World Example

```bash
idx "url: https://www.example.com/products
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

By default every `idx` call spawns a new Chromium instance (~3800 ms cold-start).
Daemon mode keeps a browser process alive in the background so subsequent calls
connect to it instead (~540 ms warm).

### Enable

```bash
# Per-session env var
export IDX_DAEMON=true
idx "url: https://example.com\ninstructions:\n  - extract title"

# Per-invocation flag
idx --daemon "url: https://example.com\ninstructions:\n  - extract title"

# Start the server manually (optional — auto-started on first call)
npm run server
```

### How It Works

1. CLI checks `IDX_DAEMON=true` or `--daemon` flag.
2. Reads `~/.idx/server.json` (pid, port, bearer token).
3. Validates process is alive + `/health` responds OK.
4. If stale/missing: spawns `src/server.js` detached and polls until ready (≤8 s).
5. `POST /command` with Bearer token; server reuses the warm browser context.
6. Server auto-shuts down after 30 min idle.

### Security

- Localhost-only (`127.0.0.1`); not accessible remotely.
- Random OS-assigned port per startup.
- Bearer token is a UUID, stored in `~/.idx/server.json` (mode `0600`).

### State File

`~/.idx/server.json` — written atomically; override path with `IDX_STATE_FILE`.

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
unset IDX_DAEMON           # revert to stateless for this session
kill $(jq .pid ~/.idx/server.json)  # stop the daemon manually
```

---

## DOM Inspector (`idx snap`)

Inspect the live DOM of any page without writing a full task. Outputs simplified DOM JSON
to stdout; useful for debugging selectors, auditing interactive elements, or feeding
context to other tools.

```
idx snap <url> [flags]
```

### Flags

| Flag | Description |
|------|-------------|
| `--aria` | Show ariaSnapshot (ARIA YAML tree) instead of DOM JSON |
| `-i` | Interactive only: dom → xpath-indexed nodes; aria → role+name lines |
| `-a` | Annotated screenshot → `/tmp/idx-dom-annotated.png` (dom mode only) |
| `-d <N>` | Depth limit — truncate tree at depth N (dom mode only) |
| `-s <selector>` | Scope output to a CSS selector subtree (dom mode only) |

Two representations are available:

- **DOM tree** (default): XPath-indexed JSON — what the AI sees in dom mode
- **ARIA snapshot** (`--aria`): Playwright `ariaSnapshot()` YAML — what the AI sees in aria mode

Use `--aria` to verify what the AI reasons over when running with `--mode aria`.

### Examples

```bash
# Full DOM of a page (dom mode representation)
idx snap https://example.com

# ARIA snapshot (aria mode representation)
idx snap --aria https://example.com

# ARIA snapshot — interactive elements only (role + name present)
idx snap --aria -i https://example.com

# DOM: interactive elements only (reduces noise)
idx snap https://example.com -i

# DOM: annotated screenshot highlighting all interactive elements
idx snap https://example.com -a

# DOM: limit tree depth to 4 levels
idx snap https://example.com -d 4

# DOM: scope to the navigation bar only
idx snap https://example.com -s "nav"

# DOM: interactive elements in sidebar, depth 3, with screenshot
idx snap https://example.com -i -s "#sidebar" -d 3 -a
```

DOM mode outputs JSON on stdout with header `=== DOM Tree ===`.
ARIA mode outputs YAML on stdout with header `=== ARIA Snapshot ===`.
With `-a` (dom), the screenshot path is printed to stderr:

```bash
# Capture DOM JSON and screenshot in one shot
idx snap https://example.com -i -a > dom.json
# → stderr: Annotated screenshot: /tmp/idx-dom-annotated.png
```

---

## Snapshot Diffing (Automatic)

**Internal optimization — no user action required.**

In loops and multi-step tasks, idx tracks snapshots between actions. Instead of
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

idx uses Playwright's `ariaSnapshot()` to represent pages to the AI, instead of
raw DOM/HTML. The ARIA snapshot is a hierarchical accessibility tree: roles, names,
labels, and visible text — the same structure used by screen readers.

**Why it matters:**
- ~38x smaller context (e.g. 592 kB raw DOM → ~15 kB ARIA snapshot on large pages)
- Semantically cleaner: no inline styles, script blocks, SVG noise
- More reliable element targeting: AI returns `{role, name}` descriptors, which
  Playwright resolves via `getByRole` / `getByLabel` / `getByText`

**Mode selection:** by default idx scores the ARIA snapshot quality (sparsity
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
- Check browser window to see what's blocking the action
- Use `BROWSER_SLOWMO` to slow down and observe

```bash
BROWSER_SLOWMO=500 idx "..."
```

### Issue: Element Not Found

**Symptom**: `Unable to resolve element descriptor: {...}` or action failure
mentioning `hidden, disabled, or covered by another element`

**Solutions**:
- Run `idx snap <url> -i` to list interactive elements and their `@refs`
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
DEBUG=* idx "..."
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
BROWSER_HEADLESS=false BROWSER_SLOWMO=500 idx "..."
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
| `BROWSER_HEADLESS` | true/false | false | Run browser headless |
| `BROWSER_SLOWMO` | milliseconds | 100 | Slow down browser actions |
| `BROWSER_TIMEOUT` | milliseconds | 30000 | Page load timeout |

### Observability
| Variable | Values | Default | Purpose |
|----------|--------|---------|---------|
| `NDJSON_STREAM` | true/false | false | Stream browser events as NDJSON to stdout |

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
- `--cookies` flag requires macOS (no Windows/Linux)
- May struggle with heavily JavaScript-rendered content
- No built-in retry on transient failures (but logs indicate when/why to retry)
- Browser automation is slower than direct API calls

## License

ISC

## Support

For issues and feedback, see `.env.example` for configuration help or check logs for detailed error messages.
