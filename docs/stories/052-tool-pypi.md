# 052 - Tool: pypi

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/ai-coding-assistant.md)

## Goal

Fetch Python package metadata and latest changelog entry from PyPI for a given
package name, returning structured data ready for scripting or display.

## Stories

- As a CLI user, I run `ibr tool pypi --param package=requests` to retrieve
  name, latest version, description, license, homepage, requires-python, author,
  and last release date.
- As a CLI user, I also get the latest changelog/release notes entry when the
  project description includes one.
- As a CLI user, omitting `package` produces a non-zero exit with a clear error.

## Acceptance Criteria

- Navigates to `https://pypi.org/project/<package>/`.
- Extracts: `name`, `version`, `description`, `license`, `homepage`,
  `requires_python`, `author`, `last_release_date`.
- Extracts latest changelog entry when present in project description.
- Missing required param `package` → non-zero exit with "Missing required param: package".
- Exit code 0 on successful extraction; stdout contains "Task execution completed".

## E2E Coverage

- `test/e2e/cli-tool-vcr.test.js` — VCR: exits 0, no config errors; required
  param validation.
