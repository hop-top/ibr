# AI Coding Assistant

## Description

AI agent (Claude Code, Copilot, Cursor, etc.) invoking idx to perform web
interactions on behalf of a developer. Cares about deterministic behavior,
machine-readable output, clear error codes, and no interactive prompts.

## Stories

- [014 - Headless Execution](../stories/014-headless-execution.md)
- [015 - Machine-Readable Errors](../stories/015-machine-readable-errors.md)
- [016 - Non-Interactive Mode](../stories/016-non-interactive-mode.md)
- [021 - High-Precision AI-Actionable Errors](../stories/021-high-precision-errors.md)

## Related Stories

- [008 - Structured Output](../stories/008-structured-output.md)
  (Integrator story; also consumed by AI coding assistants)
- [009 - Error Propagation](../stories/009-error-propagation.md)
  (Integrator story; relied on by AI coding assistants)
