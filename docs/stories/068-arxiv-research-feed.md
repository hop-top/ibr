# Story: 068 - ArXiv AI Research Feed

**Persona:** Business Manager
**Objective:** Maintain a pulse on the latest AI architecture breakthroughs.

## Narrative

I need to stay ahead of AI trends. I have my agent use the `arxiv` tool via `ibr` 
to extract the latest papers on "browser agents" every morning.

## Instructions

```bash
ibr tool arxiv --param query="cat:cs.AI AND browser agents" --param count=5
```

## Augmentations

- **Clean PDF Links**: Ensure the AI sees direct PDF links clearly.
- **Rule**: `{"addClass": ["direct-link", "a[href*='pdf']"]}`

## E2E Coverage

**Existing E2E coverage**

- [business-manager.test.js](../../test/e2e/showcase/business-manager.test.js) —
  `it('068: ArXiv AI Research Feed (arxiv tool)')` — cassette-backed
  (`showcase-068-arxiv-tool`), invokes `ibr tool arxiv --param
  query="cat:cs.AI AND browser agents" --param count=2`. Proves the `arxiv` tool
  subcommand parses its params and the run completes (exit 0).
- Gated: `test/e2e/**` excluded unless a real Playwright Chromium launches
  ([vitest.config.js](../../test/vitest.config.js)); browser is real, only the AI
  is mocked. Did not run in this environment (no Chromium).

**Expected E2E coverage for full criteria**

- The story wants recent papers (title, authors, abstract, arXiv URL) for the
  query; the test asserts exit code only. The `showcase-068-arxiv-tool` cassette
  replays an arXiv "produced no results" page and empty extraction (`[]`), so no
  papers are proven — the run succeeds precisely because there is nothing to
  extract. A stronger test needs a cassette recorded against a populated arXiv
  result set and an assertion on the extracted paper list (count and fields), plus
  `count=5` to match the story.
