# Story: 071 - Amazon Review Summary

**Persona:** Personal Shopper
**Objective:** Vet a product's quality using detailed review extraction.

## Narrative

I need to confirm if a specific laptop has overheating issues. I use the 
`amazon` tool via `ibr` to find the product and extract reviews that mention 
"heat" or "fan".

## Instructions

```bash
ibr tool amazon --param query="macbook pro m3 overheating" --param count=1
```

## Augmentations

- **Isolate Reviews**: Focus the AI on the customer review section.
- **Rule**: `{"isolate": ["#customerReviews", "#reviews-medley-footer"]}`

## E2E Coverage

Related tool story: [049 — amazon tool](049-tool-amazon.md) (the underlying
`ibr tool amazon` path this persona narrative invokes).

**Existing E2E coverage**

- [personal-shopper.test.js](../../test/e2e/showcase/personal-shopper.test.js) —
  `it('071: Review Summary (amazon)')`, cassette `showcase-071-amazon`.
  Spawns `node src/index.js` against an Amazon `/dp/…` URL with an
  `extract the product title` instruction; the AI is faked (VCR positional-FIFO
  queue via `test/helpers/fakeAIServerE2E.js`), the browser is real. Proves
  only: **the run completes and exits 0**. The single assertion is
  `expect(result.code).toBe(0)` — no content is asserted. The cassette's
  extraction response is non-empty (`["Dogs of Amazon"]`) but that is Amazon's
  error-page placeholder, not a real product title, and it is never asserted
  against.

**Caveat: browser-gated suite**

- `test/vitest.config.js` runs `detectBrowserSupport()` at load, launching real
  Chromium. Where Chromium is absent the entire `test/e2e/**` tree is excluded
  ("No test files found") and this test does not run. Coverage here is a
  shallow exit-0 smoke check, not a content proof.

**Expected E2E coverage for full criteria**

- Review extraction — the story is about pulling reviews mentioning "heat" /
  "fan", but the test extracts a **product title**, not reviews. No review
  content, filtering, or summary is exercised.
- The `ibr tool amazon --param query=… --param count=1` tool path the narrative
  uses (cross-ref story 049), rather than a bare `/dp/…` URL.
- Review-isolation augmentation (`{"isolate": ["#customerReviews", …]}`) effect.
- A non-empty cassette pinning a real extracted value instead of the
  "Dogs of Amazon" placeholder.
