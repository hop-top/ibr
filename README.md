# idx - Intent Driven eXtractor

An AI-powered instruction parser that converts human-readable instructions into automated web interactions. Powered by Playwright for browser automation and Vercel AI SDK for multi-provider AI support.

## Features

- **Multi-Provider AI Support**: OpenAI, Anthropic Claude, Google Gemini
- **Natural Language Instructions**: Describe what you want in plain English
- **Automatic Element Detection**: AI finds elements based on descriptions
- **Data Extraction**: Extract structured data from web pages
- **Conditional Logic**: If-then instructions for dynamic flows
- **Loop Support**: Repeat actions until conditions are met
- **Comprehensive Logging**: Detailed execution logs for debugging

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

## How It Works

1. **Parse Instructions**: AI converts your natural language prompt into structured JSON
2. **Navigate**: Opens the URL in a Playwright browser
3. **Execute**: For each instruction:
   - Simplifies the DOM for AI analysis
   - Asks AI to find/locate the element
   - Performs the action (click, fill, extract, etc.)
   - Tracks token usage across all providers
4. **Extract Data**: Returns extracted information from the page

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

**Symptom**: "No matching elements found" for an action

**Solutions**:
- Be more specific in description: instead of "button", try "submit button in form"
- Check if element requires scrolling into view (tool does this automatically)
- Verify element exists on page (check browser window)
- Try alternative text descriptions

### Issue: JSON Parsing Errors

**Symptom**: "Failed to parse JSON response" from AI model

**Solutions**:
- The AI model returned invalid JSON
- Try rephrasing your prompt more clearly
- Ensure extracted data actually exists on page
- Check logs for what the model returned

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
- Can't handle login/authentication (design limitation)
- May struggle with heavily JavaScript-rendered content
- No built-in retry on transient failures (but logs indicate when/why to retry)
- Browser automation is slower than direct API calls

## License

ISC

## Support

For issues and feedback, see `.env.example` for configuration help or check logs for detailed error messages.
