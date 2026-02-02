// BAML Schema for idx response parsing
// Handles structured output from AI models, with flexible parsing for markdown/JSON variations
//
// NOTE: This schema defines expected output structures only.
// Client/provider configuration is handled dynamically in src/ai/baml-parser.js
// which adapts to the active AI provider (OpenAI, Anthropic, Google, or Ollama)

// Task Description - parsed from initial user instruction
class TaskDescription {
  url string @description("The URL target for the instructions")
  instructions Instruction[]
}

// Individual instruction object
class Instruction {
  name string @description("Instruction type: loop, condition, extract, click, fill, type, press, scroll")
  prompt string @description("What to do or find")

  // Optional nested instructions for loops
  instructions Instruction[]?

  // Optional conditional branches
  success_instructions Instruction[]?
  failure_instructions Instruction[]?
}

// Find Elements - returns array of matching DOM elements
class FindElementsResult {
  elements DOMElement[]
}

class DOMElement {
  tag_name string?
  text string?
  xpath string?
  id string?
  class string?
  attributes Record<string, string>?
}

// Action Instruction - what action to perform
class ActionInstructionResult {
  elements DOMElement[]
  type string @description("Action type: click, fill, type, press, scroll")
  value string?
}

// Extract Data - array of extracted values
class ExtractDataResult {
  data string[]
}

// Extraction wrapper for backward compatibility
class ExtractResult {
  data string[]
}

// Element array (for simpler find responses)
class ElementArray {
  elements DOMElement[]
}

// BAML functions are defined here as documentation only.
// Actual parsing is handled dynamically in src/ai/baml-parser.js
// which works with any configured AI provider without hardcoding client details.
