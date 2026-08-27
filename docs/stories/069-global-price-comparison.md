# Story: 069 - Global Price Comparison

**Persona:** Personal Shopper
**Objective:** Find the cheapest global price for a high-value collector's item.

## Narrative

I need to source a vintage Rolex for a client. I use the `ebay` tool via `ibr` 
to compare prices on eBay US and eBay UK.

## Instructions

```bash
# Search eBay US
ibr tool ebay --param query="vintage rolex datejust" --param domain="ebay.com"

# Search eBay UK
ibr tool ebay --param query="vintage rolex datejust" --param domain="ebay.co.uk"
```

## Augmentations

- **Remove Sponsored**: Hide sponsored listings to avoid skewed pricing data.
- **Rule**: `{"remove": [".s-item__sep", ".s-item__location"]}`

## E2E Coverage

**Existing E2E coverage**

- [personal-shopper.test.js](../../test/e2e/showcase/personal-shopper.test.js) —
  `it('069: Global Price Comparison (eBay)')`, cassette `showcase-069-ebay`.
  Spawns `node src/index.js` against an eBay item URL with an
  `extract the price` instruction; the AI is faked (VCR positional-FIFO
  queue via `test/helpers/fakeAIServerE2E.js`), the browser is real.
  Proves only: **the run completes and exits 0**. The single assertion is
  `expect(result.code).toBe(0)` — no content is asserted, and the cassette's
  extraction response is an **empty `[]`**, so no price value is exercised.

**Caveat: browser-gated suite**

- `test/vitest.config.js` runs `detectBrowserSupport()` at load, launching real
  Chromium. Where Chromium is absent the entire `test/e2e/**` tree is excluded
  ("No test files found") and this test does not run. Coverage here is a
  shallow exit-0 smoke check, not a content proof.

**Expected E2E coverage for full criteria**

- Multi-domain price comparison (`ebay.com` vs `ebay.co.uk`) and the `ebay`
  tool path — the test uses a bare item URL, not `ibr tool ebay --param domain=…`
  as the narrative describes.
- Sponsored-removal augmentation (`{"remove": [".s-item__sep", …]}`) effect.
- Assert an actual extracted price rather than replaying an empty `[]`; a
  non-empty cassette that pins a real price value.
