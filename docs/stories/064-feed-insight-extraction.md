# Story: 064 - Feed-based Insight Extraction

**Persona:** Homeowner
**Objective:** Extract summaries from a personal news feed about home energy efficiency.

## Narrative

I use Miniflux to follow energy-saving blogs. Instead of reading them all, I have my AI 
agent use `ibr` to extract the titles and summaries of the last 5 posts so I can decide 
what to prioritize for my home.

## Instructions

```yaml
url: https://miniflux.app/blog
instructions:
  - extract the titles and dates of the first 5 articles
  - for each article, extract the first paragraph of the description
```

## Augmentations

- **Isolate Content**: Remove headers and footers to focus the AI on the article list.
- **Rule**: `{"isolate": ["main"]}`

## E2E Coverage

**Existing E2E coverage**

- [homeowner.test.js](../../test/e2e/showcase/homeowner.test.js) — `it('064:
  Feed-based Insight Extraction (miniflux.app)')` — cassette-backed
  (`showcase-064-miniflux`), drives the feed URL, an `extract titles and dates`
  step, and a per-article `loop` extracting the first description paragraph, with
  the `isolate: ['main']` augmentation rule applied. Proves the extract + loop
  plan runs to completion (exit 0).
- Gated: `test/e2e/**` excluded unless a real Playwright Chromium launches
  ([vitest.config.js](../../test/vitest.config.js)); browser is real, only the AI
  is mocked. Did not run in this environment (no Chromium).

**Expected E2E coverage for full criteria**

- The story wants the last 5 feed titles + summaries; the test extracts the first
  3 and asserts exit code only. The `showcase-064-miniflux` cassette replays empty
  extraction (`[]`), so titles/summaries are not proven. A stronger test needs a
  cassette recorded against a populated feed and an assertion on the extracted
  titles/dates/summaries (via the `Extracted data` log payload), not just run
  completion. Bump the count to 5 to match the story.
