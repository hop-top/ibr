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

Creates a prompt for finding elements on a web page based on user instructions.

### Parameters
- `userPrompt` (string): The user's instruction for finding elements
- `domTree` (object): Hierarchical tree representation of the page's DOM

### Returns
An array of message objects with 'system' and 'user' roles.

### Purpose
- Helps identify DOM elements that match the user's search criteria
- Works with the page's DOM tree structure

### Example
```javascript
// Input
makeFindInstructionMessage("find all buttons", domTree);
```

## makeActionInstructionMessage

Generates a prompt for performing actions on web page elements.

### Parameters
- `userPrompt` (string): The user's instruction for the action
- `domTree` (object): Hierarchical tree representation of the page's DOM

### Returns
An array of message objects with 'system' and 'user' roles.

### Supported Actions
- `click`: Click on an element
- `fill`: Fill a form field
- `type`: Type into an input field
- `press`: Press a key
- `scroll`: Scroll the element (not implemented yet)

### Response Structure
```typescript
{
  elements: Array<Element>,
  type: 'click' | 'fill' | 'type' | 'press' | 'scroll',
  value?: string
}
```

## makeExtractInstructionMessage

Creates a prompt for extracting content from web page elements.

### Parameters
- `userPrompt` (string): The user's extraction instructions
- `domTree` (object): Hierarchical tree representation of the page's DOM

### Returns
An array of message objects with 'system' and 'user' roles.

### Key Features
- Extracts exact text content from DOM elements
- Preserves all symbols, characters, and line breaks
- Returns results as a JSON array
- Returns an empty array if no matches are found

### Example
```javascript
// Input
makeExtractInstructionMessage("extract all product prices", domTree);
```

## Usage Notes

1. All DOM tree representations follow this structure:
   ```typescript
   interface DOMNode {
     n: string;      // tag name
     t?: string;     // text content
     a?: string[];   // list of attributes
     c?: DOMNode[];  // child elements
   }
   ```

2. When working with extracted content, always handle cases where the result might be an empty array.

3. For complex automation tasks, combine multiple instruction types using the structured format from `makeTaskDescriptionMessage`.
