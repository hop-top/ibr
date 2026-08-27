# Story: 070 - Historical Value Research

**Persona:** Personal Shopper
**Objective:** Determine if an item is truly "on sale" by checking historical prices.

## Narrative

A client is looking at an "original" price of $500. I use `ibr` and the Wayback 
Machine to check what this item was selling for in 2021.

## Instructions

```yaml
url: https://web.archive.org/web/20210601000000/https://example-shop.com/item-123
instructions:
  - extract the price listed on the page
  - compare it with the current price on the live site
  - extract the description to see if the specs have changed
```

## Augmentations

- **Wayback Cleanup**: Hide the Wayback toolbar to ensure the AI only sees the 
  archived content.
- **Rule**: `{"remove": ["#wm-ipp-base"]}`

## E2E Coverage

**Existing E2E coverage**

- [personal-shopper.test.js](../../test/e2e/showcase/personal-shopper.test.js) —
  `it('070: Historical Value Research (archive.org)')`, cassette
  `showcase-070-historical-shop`. Spawns `node src/index.js` against a
  `web.archive.org/web/…` snapshot URL with an
  `extract the price listed on the page` instruction; the AI is faked (VCR
  positional-FIFO queue via `test/helpers/fakeAIServerE2E.js`), the browser is
  real. Proves only: **the run completes and exits 0**. The single assertion is
  `expect(result.code).toBe(0)` — no content is asserted, and the cassette's
  extraction response is an **empty `[]`**, so no historical price value is
  exercised.

**Caveat: browser-gated suite**

- `test/vitest.config.js` runs `detectBrowserSupport()` at load, launching real
  Chromium. Where Chromium is absent the entire `test/e2e/**` tree is excluded
  ("No test files found") and this test does not run. Coverage here is a
  shallow exit-0 smoke check, not a content proof.

**Expected E2E coverage for full criteria**

- The cross-time comparison the story asks for (archived price vs live price)
  and the description/specs diff — the test extracts one price from one archived
  snapshot only; there is no live-site fetch or comparison.
- Wayback-toolbar cleanup augmentation (`{"remove": ["#wm-ipp-base"]}`) effect.
- Assert an actual extracted price rather than replaying an empty `[]`; a
  non-empty cassette that pins a real archived price value.
