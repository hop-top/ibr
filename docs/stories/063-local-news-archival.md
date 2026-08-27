# Story: 063 - Local News Archival

**Persona:** Homeowner
**Objective:** Archive the front page of a community blog to the Wayback Machine.

## Narrative

As a homeowner, I want to preserve the history of our neighborhood by archiving the 
local community blog every time a major event is posted. I use `ibr` to navigate 
to `archive.org/save` and trigger a snapshot of the blog.

## Instructions

```yaml
url: https://web.archive.org/save
instructions:
  - fill "URL to save" with "https://miniflux.app/blog"
  - click "SAVE PAGE"
  - wait for "Job has been submitted" message
```

## Augmentations

- **Remove Overlays**: Archive.org sometimes shows donation banners that can block the "SAVE PAGE" button.
- **Rule**: `{"remove": ["#don-reg", ".banner"]}`

## E2E Coverage

**Existing E2E coverage**

- [homeowner.test.js](../../test/e2e/showcase/homeowner.test.js) — `it('063: Local
  News Archival (archive.org)')` — cassette-backed (`showcase-063-archive-org`),
  drives the story's `fill "URL to save"` + `click "SAVE PAGE"` instructions and
  applies the `remove: ['#don-reg', '.banner']` augmentation rule via
  `IBR_AUGMENTATIONS_FILE`. Proves the archival flow plans and executes the fill +
  click without error (exit 0).
- Gated: the whole `test/e2e/**` suite is excluded unless a real Playwright
  Chromium launches (`detectBrowserSupport()` in
  [vitest.config.js](../../test/vitest.config.js)). Only the AI is mocked (VCR
  cassette); the browser is real. Did not run in this environment (no Chromium).

**Expected E2E coverage for full criteria**

- The assertion is exit-code only (`expect(result.code).toBe(0)`); the story's
  "wait for 'Job has been submitted' message" is not asserted. A stronger test
  should assert the submission-confirmation reached (parse the `Extracted data`
  log or a confirmation snapshot) rather than run completion alone.
