# Story: 066 - Competitor Pricing Audit

**Persona:** Business Manager
**Objective:** Compare current pricing with historical data to detect strategy shifts.

## Narrative

I need to know if our competitor has increased their prices. I use `ibr` to 
check their live pricing and then use the Wayback Machine to check what it 
was 6 months ago.

## Instructions

```yaml
url: https://web.archive.org/web/20231001000000/https://miniflux.app/pricing
instructions:
  - extract all pricing plan names and their costs
  - navigate to https://miniflux.app/pricing
  - extract current pricing plan names and costs
  - compare the two and flag any increases
```

## Augmentations

- **Cleanup plans**: Remove the "Sign up" buttons to focus on the text content.
- **Rule**: `{"remove": [".button-primary", ".button-secondary"]}`

## E2E Coverage

**Existing E2E coverage**

- [business-manager.test.js](../../test/e2e/showcase/business-manager.test.js) —
  `it('066: Competitor Pricing Audit (archive.org vs live)')` — cassette-backed
  (`showcase-066-pricing-audit`), drives the archived-pricing URL, an `extract all
  pricing plan names` step, a `navigate to .../pricing` step, and a second
  `extract current pricing plan names` step. Proves the archived-vs-live two-page
  extract plan runs to completion (exit 0).
- Gated: `test/e2e/**` excluded unless a real Playwright Chromium launches
  ([vitest.config.js](../../test/vitest.config.js)); browser is real, only the AI
  is mocked. Did not run in this environment (no Chromium).

**Expected E2E coverage for full criteria**

- The story wants archived plan names/costs compared against live and increases
  flagged; the test asserts exit code only. The `showcase-066-pricing-audit`
  cassette replays empty extraction (`[]`) for both pages, so no plan names, no
  costs, and no comparison are proven. A stronger test needs cassettes recorded
  against real archived + live pricing pages, an assertion on the two extracted
  plan sets, and a `compare/flag increases` step (absent from the current
  instructions).
