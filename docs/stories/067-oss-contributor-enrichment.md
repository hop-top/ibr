# Story: 067 - OSS Contributor Enrichment

**Persona:** Business Manager
**Objective:** Identify and enrich a list of contributors from a relevant OSS project.

## Narrative

I want to find talent for our new browser team. I use `ibr` to go to the 
Playwright repository and extract the top contributors' GitHub handles and 
bios.

## Instructions

```yaml
url: https://github.com/microsoft/playwright/graphs/contributors
instructions:
  - wait for the contributor list to load
  - extract the top 10 contributor usernames
  - for each contributor, navigate to their profile and extract their blog URL
```

## Augmentations

- **Remove GitHub Headers**: Simplify the UI by removing the sticky header.
- **Rule**: `{"remove": [".Header", ".js-header-wrapper"]}`

## E2E Coverage

**Existing E2E coverage**

- [business-manager.test.js](../../test/e2e/showcase/business-manager.test.js) —
  `it('067: OSS Contributor Enrichment (GitHub)')` — cassette-backed
  (`showcase-067-github-contributors`), navigates the Playwright repo and runs a
  single `extract the number of stars` step (cassette replays `["87k"]`). Proves a
  GitHub-page extraction runs to completion (exit 0) and returns a non-empty
  value.
- Gated: `test/e2e/**` excluded unless a real Playwright Chromium launches
  ([vitest.config.js](../../test/vitest.config.js)); browser is real, only the AI
  is mocked. Did not run in this environment (no Chromium).

**Expected E2E coverage for full criteria**

- The story wants the top-10 contributor GitHub handles from the
  `/graphs/contributors` page plus each contributor's blog URL; the test instead
  extracts a star count from the repo landing page and asserts exit code only.
  This is a substituted, weaker scenario — contributor handles are not exercised
  at all. A stronger test needs the contributors URL, a cassette that replays a
  list of handles, a per-contributor profile-navigation loop, and an assertion on
  the extracted handles/blog URLs.
