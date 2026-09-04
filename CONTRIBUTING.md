# Contributing to ibr

Thanks for your interest in ibr (Intent Browser Runtime). This guide covers
getting set up, running the tests, and submitting a change.

## Prerequisites

- **Node.js 22.x or 24.x.** CI runs the test matrix on those two versions
  across Linux, macOS and Windows, so they are what a change is verified
  against.
- **npm** (the repo ships a `package-lock.json`; use `npm ci` for a
  reproducible install).
- **Chromium**, installed through Playwright — needed for the browser-backed
  tests and to run the CLI against a real page.

Optionally, [Task](https://taskfile.dev) — `Taskfile.yml` wraps the common npm
scripts (`task test`, `task build`, `task bench`), but every one of them has a
plain `npm run` equivalent, and this guide uses those.

## Setup

```bash
git clone https://github.com/hop-top/ibr
cd ibr
npm ci
npm run browser:install    # installs Playwright's chromium
```

To actually run the CLI you need an AI provider key. Copy the example
environment file and fill in the provider you intend to use:

```bash
cp .env.example .env
```

Set `AI_PROVIDER` to `openai`, `anthropic` or `google`, and set only that
provider's key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or
`GOOGLE_GENERATIVE_AI_API_KEY`). The README's Setup section documents the
remaining variables.

## Running the CLI locally

Run from source without installing anything globally:

```bash
node src/index.js --help

node src/index.js "url: https://example.com
instructions:
  - extract the page title"
```

`npm start` is the same entry point, and `npm run dev` runs it under
`node --watch`.

`ibr snap` needs no API key and no AI call, which makes it the quickest way to
check that your environment and browser work at all:

```bash
node src/index.js snap https://example.com -i
```

## Running tests

The suites split by directory:

```bash
npm test               # everything
npm run test:unit      # test/unit/       — no browser
npm run test:integration
npm run test:e2e       # test/e2e/        — real Chromium
npm run test:e2e:fast  # the "fast" tagged e2e subset (E2E_TAGS=fast)
npm run test:coverage
```

`npm run test:unit` is the fast inner loop and the one to run constantly.
`npm run test:watch` keeps vitest running against the whole suite.

### Browser-backed tests are gated, and gate *silently*

`test/vitest.config.js` calls `detectBrowserSupport()` at config load: it tries
to launch headless Chromium once. If that fails, the config **adds
`test/e2e/**`, `test/integration/**` and
`test/unit/helpers/buildOperations.test.js` to the exclude list** — those tests
do not run and do not fail. A green run is therefore not proof the
browser-backed suites passed; check the reported file count.

If you expected e2e to run and it did not, run `npm run browser:install` and
try again. The same probe sets `PLAYWRIGHT_BROWSER_TESTS` for tests that branch
on browser availability.

Because the filter is an exclude list, running `npm run test:e2e` with no
usable Chromium matches zero files and vitest exits non-zero — that failure is
about the missing browser, not about your change.

### Two known pre-existing failures

Both fail on a clean checkout of `main`. If you see only these, you have not
broken anything:

| Test | File | Why |
|------|------|-----|
| `068: ArXiv AI Research Feed` | `test/e2e/showcase/business-manager.test.js` | Network-dependent — hits a live site |
| `snap current (BROWSER_REUSE_PAGE)` | `test/e2e/cli-browser-features.test.js` | Pre-existing |

Please don't "fix" these as a side effect of an unrelated change; if you want
to take one on, make it its own change with its own reasoning.

## Making a change

### Tests

For a **bug fix**, write the failing test first. Then confirm the test is
actually pinning the behaviour you think it is by mutating it: re-introduce the
original defect, watch the new test go **red**, then restore the fix and watch
it go green. A test that has only ever been observed passing next to a fix
proves nothing. It is worth doing this deliberately — it regularly catches
tests that assert today's output rather than the requirement.

For a **new behaviour**, cover it in `test/unit/` where it can be tested
without a browser, and add an e2e case when the behaviour only exists end to
end (a real page, a real Playwright action).

### Documentation

User-visible changes update the docs in the same change. Where things live:

| Path | Audience |
|------|----------|
| `README.md` | The reference — flags, env vars, behaviour, prose |
| `docs/cheatsheet.md` | Human quick-reference; scannable, command-first |
| `docs/cheatsheet-agent.md` | AI agent consumers; terse, table-driven, structured error codes and JSON shapes |
| `docs/stories/` | Behaviour stories — goal, user stories, acceptance criteria, test coverage |
| `docs/adr/` | Architecture decision records |

A new error code, flag or environment variable in particular needs to reach
both cheatsheets — agents branch on `error.code`, so an undocumented code is a
contract gap, not a documentation nicety.

### Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

Types in use: `feat`, `fix`, `refactor`, `build`, `ci`, `chore`, `docs`,
`style`, `perf`, `test`. The scope is optional but encouraged (`fix(visual):`,
`docs(stories):`, `test(e2e):`). Breaking changes take a `!` before the colon
or a `BREAKING CHANGE:` trailer.

Keep the subject imperative and specific about what changed. `git log
--oneline` shows the house style.

## Submitting

1. Branch off `main`.
2. Make the change, with tests and doc updates alongside it.
3. Run `npm run test:unit` at minimum; run the browser-backed suites too if
   your change touches browser behaviour.
4. Open a pull request describing what changed and why. If the change is
   user-visible, say what a user will now see differently.

CI runs on every pull request: the unit and integration suites plus a bundle
build across Linux/macOS/Windows on Node 22 and 24
(`.github/workflows/ci.yml`), and the Playwright e2e suites
(`.github/workflows/e2e-playwright.yml`) — the fast subset on all three
platforms, the full suite on Linux.

## Questions

If something here is wrong or missing, that is worth a pull request too.
