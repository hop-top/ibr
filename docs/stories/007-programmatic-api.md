# 007 - Programmatic API

**Persona:** [Integrator](../personas/integrator.md)

## Goal

Import and invoke idx from Node.js code without spawning a subprocess.

## Stories

- As an integrator, I `import { idx } from '@hop/idx'` and call it with a
  prompt object to drive browser automation from my pipeline.
- As an integrator, I await the result so my script proceeds after idx
  completes.

## Acceptance Criteria

- Package exports a callable `idx(prompt)` function.
- Accepts same prompt schema as CLI (url + instructions).
- Returns a Promise resolving to extracted data + token usage summary.
- Rejects with a structured error object on failure.
