# Prompt Utilities Documentation

This document describes the prompt utility functions used in the application for processing user instructions and interacting with web pages.

## Table of Contents
- [makeTaskDescriptionMessage](#maketaskdescriptionmessage)
- [makeFindInstructionMessage](#makefindinstructionmessage)
- [makeActionInstructionMessage](#makeactioninstructionmessage)
- [makeExtractInstructionMessage](#makeextractinstructionmessage)

## makeTaskDescriptionMessage

Converts a user's natural language instructions into a structured JSON format for web automation tasks.

### Parameters
- `userPrompt` (string): The user's natural language instructions

### Returns
An array of message objects with 'system' and 'user' roles for LLM processing.

### Structure
- **System Prompt**:
  - Defines the parser's role and expected output format
  - Specifies the JSON structure for different instruction types
  - Lists supported instruction types: loop, condition, extract, click, fill, type, press, scroll (not implemented yet)

### Example Input/Output
```javascript
// Input
makeTaskDescriptionMessage("Go to example.com, click login, and extract the welcome message");

// Output (simplified)
[
  { role: 'system', content: 'You are a parser...' },
  { role: 'user', content: 'Go to example.com...' }
]
```

## makeFindInstructionMessage

Prompt for finding elements; receives ARIA snapshot of current page.

### Parameters
- `userPrompt` (string): instruction describing elements to find
- `pageContext` (string): ARIA snapshot (or DomSimplifier JSON fallback)

### Returns
Array of message objects (`system` + `user` roles).

### Purpose
- Identifies ARIA-addressable elements matching the user instruction
- AI returns `[{role, name}]` descriptors; resolved by `resolveElement()`

### Example
```javascript
makeFindInstructionMessage("find all buttons", ariaSnapshotString);
// AI response: [{"role": "button", "name": "Sign in"}]
```

## makeActionInstructionMessage

Prompt for performing an action; receives ARIA snapshot of current page.

### Parameters
- `userPrompt` (string): instruction describing the action
- `pageContext` (string): ARIA snapshot (or DomSimplifier JSON fallback)

### Returns
Array of message objects (`system` + `user` roles).

### Supported Actions
- `click`: click an element
- `fill`: fill a form field
- `type`: type into an input
- `press`: press a key
- `scroll`: scroll (not yet implemented)

### Response Structure
```typescript
{
  elements: Array<{role: string, name: string}>,
  type: 'click' | 'fill' | 'type' | 'press' | 'scroll',
  value?: string
}
```

## makeExtractInstructionMessage

Prompt for extracting content; receives ARIA snapshot of current page.

### Parameters
- `userPrompt` (string): extraction instruction
- `pageContext` (string): ARIA snapshot (or DomSimplifier JSON fallback)

### Returns
Array of message objects (`system` + `user` roles).

### Key Features
- Extracts exact text from ARIA-visible content
- Preserves symbols, characters, line breaks
- Returns JSON array; empty array if nothing found

### Example
```javascript
makeExtractInstructionMessage("extract all product prices", ariaSnapshotString);
```

## Usage Notes

### Page context format (primary — ARIA snapshot)

`pageContext` is the string returned by `getSnapshot()` from `ariaSimplifier.js`.
Looks like:

```
- heading "Products" [level=1]
- button "Add to cart"
- link "Learn more"
- textbox "Search"
```

### Page context format (fallback — DomSimplifier)

When ARIA snapshot exceeds 50 000 chars, `pageContext` is compact JSON:

```typescript
interface DOMNode {
  x: number;      // XPath index (for element resolution)
  n: string;      // tag name
  t?: string;     // text content
  a?: object;     // filtered attributes
  c?: DOMNode[];  // children
}
```

In fallback mode, AI may return `{x: index}` descriptors; `Operations.js`
resolves them via the XPath table maintained by `DomSimplifier`.

2. Always handle cases where extracted result is an empty array.

3. Combine instruction types using the structured format from `makeTaskDescriptionMessage`.
