# Changelog

All notable changes to `idx` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Changed

- **Page representation: ARIA accessibility tree (T-0005)**
  - `Operations.#getPageContext()` now calls `page.locator('body').ariaSnapshot()`
    (Playwright ariaSnapshot) instead of running `DomSimplifier` by default.
  - ARIA snapshot is a semantic accessibility tree: roles, names, labels, visible
    text — no inline styles, scripts, or SVG noise.
  - Typical compression ~38x (e.g. 592 kB raw DOM → ~15 kB on large pages), reducing
    prompt token cost and improving AI accuracy.
  - **Fallback**: if ariaSnapshot exceeds 50 000 chars, transparently falls back to
    `DomSimplifier` (XPath-indexed compact JSON). No configuration required.
  - New `src/utils/ariaSimplifier.js` provides `getSnapshot(page)` and
    `resolveElement(page, descriptor)`.

- **Element descriptor format**
  - Primary path (ARIA): AI returns `{role, name}` pairs; resolved via
    `page.getByRole(role, {name})` → `getByLabel` → `getByText` → `getByPlaceholder`.
  - Fallback path (DomSimplifier): AI returns `{x: index}`; resolved via XPath
    table in `DomSimplifier`.
  - Prompts (`makeFindInstructionMessage`, `makeActionInstructionMessage`,
    `makeExtractInstructionMessage`) updated to instruct AI to return
    `{role, name}` descriptors and include the ARIA snapshot as page context.

### Internal

- `Operations.#actionInstruction` and `#findElements` pass `isAria` flag through
  to choose the correct locator strategy at resolution time.
- Cache schema now stores `elementDescriptors` as ARIA `{role, name}` objects.

### Impact on users

None expected. Prompt language is unchanged — describe elements in plain English
as before. The ARIA path / DomSimplifier selection is fully automatic.
