# 040 - Tool Subcommand

**Persona:** [CLI User](../personas/cli-user.md),
[AI Coding Assistant](../personas/cli-user.md)

## Goal

Run pre-defined browser automation workflows from YAML tool files without
writing a full prompt each time.

## Stories

- As a CLI user, I run `ibr tool web-search --param query=foo` to search
  without constructing the prompt manually.
- As a CLI user, I run `ibr tool --list` to see available tools.
- As a tool author, I create a YAML file in `tools/` to package a reusable
  browser workflow with typed params.

## Acceptance Criteria

- `ibr tool --list` prints available tool names; exits 0; no browser/API key.
- `ibr tool <name> --param k=v` loads the YAML, interpolates, runs via the
  standard ibr execution path.
- Missing required param → non-zero exit with clear error message.
- Unknown tool name → non-zero exit with "Tool not found" message.
- `ibr tool` (no name) → non-zero exit with usage hint.
- Tool YAML supports: `name`, `description`, `params[]`, `url`, `instructions[]`.
- Param defaults applied when param omitted and default defined.
- `{{param}}` placeholders in `url` and `instructions` interpolated.

## E2E Coverage

- `test/e2e/cli-tool-subcommand.test.js` — covers all acceptance criteria
  except live browser execution (config-layer tests only).

## Unit Coverage

- `test/unit/commands/tool.test.js` — covers parseToolYaml, interpolate,
  resolveParams, buildPrompt, parseToolArgs, loadAndBuildPrompt.
