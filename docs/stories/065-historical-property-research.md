# Story: 065 - Historical Property Research

**Persona:** Homeowner
**Objective:** Research historical gas prices or community news from a specific date.

## Narrative

I want to know how the neighborhood changed. I use `ibr` to navigate the 
Wayback Machine and look at the community forum as it appeared in January 2022.

## Instructions

```yaml
url: https://web.archive.org/web/20220101000000*/https://miniflux.app/blog
instructions:
  - click on the first snapshot from January 2022
  - wait for the page to load
  - extract the main headline from that date
```

## Augmentations

- **Remove Wayback UI**: Hide the top banner and timeline to simplify the view for the AI.
- **Rule**: `{"remove": ["#wm-ipp-base"]}`

## E2E Coverage

**Existing E2E coverage**

- [homeowner.test.js](../../test/e2e/showcase/homeowner.test.js) — `it('065:
  Historical Property Research (archive.org)')` — cassette-backed
  (`showcase-065-historical`), drives the Wayback calendar URL, a `click the first
  snapshot from January 2022` step, and an `extract the main headline` step.
  Proves the snapshot-click + headline-extract plan runs to completion (exit 0).
- Gated: `test/e2e/**` excluded unless a real Playwright Chromium launches
  ([vitest.config.js](../../test/vitest.config.js)); browser is real, only the AI
  is mocked. Did not run in this environment (no Chromium).

**Expected E2E coverage for full criteria**

- The story wants the headline as it appeared on a specific date; the test asserts
  exit code only. The `showcase-065-historical` cassette replays an empty click
  (`elements: []`) and empty extraction (`[]`), so the headline-by-date is not
  proven. A stronger test needs a cassette recorded against a real archived
  snapshot and an assertion on the extracted headline string.
