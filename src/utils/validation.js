import logger from './logger.js';

/**
 * Schema for task description returned by AI model
 */
const TASK_DESCRIPTION_SCHEMA = {
  url: 'string',
  instructions: 'array'
};

const INSTRUCTION_SCHEMA = {
  name: 'string',
  prompt: 'string'
};

/**
 * Validate that all required environment variables are set
 * @param {Array<string>} requiredVars - Variable names to check
 * @throws {Error} If required variables are missing
 */
export function validateEnvironmentVariables(requiredVars) {
  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please configure them in your .env file. See .env.example for details.`
    );
  }
}

/**
 * Validate task description structure
 * @param {Object} taskDesc - Task description to validate
 * @returns {boolean} True if valid
 * @throws {Error} With detailed message if invalid
 */
export function validateTaskDescription(taskDesc) {
  if (!taskDesc || typeof taskDesc !== 'object') {
    throw new Error('Task description must be a valid object');
  }

  if (!taskDesc.url || typeof taskDesc.url !== 'string') {
    throw new Error('Task description must have a "url" field (string)');
  }

  if (!Array.isArray(taskDesc.instructions)) {
    throw new Error('Task description must have "instructions" field (array)');
  }

  if (taskDesc.instructions.length === 0) {
    throw new Error('Task description must have at least one instruction');
  }

  // Validate each instruction has required fields
  for (let i = 0; i < taskDesc.instructions.length; i++) {
    const instr = taskDesc.instructions[i];
    if (!instr.name || typeof instr.name !== 'string') {
      throw new Error(`Instruction ${i} must have a "name" field (string)`);
    }
    if (!instr.prompt && instr.name !== 'loop' && instr.name !== 'condition') {
      throw new Error(`Instruction ${i} (${instr.name}) must have a "prompt" field (string)`);
    }
  }

  return true;
}

/**
 * Validate AI response structure
 * @param {Object} response - Response from AI provider
 * @returns {boolean} True if valid
 * @throws {Error} With detailed message if invalid
 */
export function validateAIResponse(response) {
  if (!response || typeof response !== 'object') {
    throw new Error('AI response must be a valid object');
  }

  if (typeof response.content !== 'string') {
    throw new Error('AI response must have a "content" field (string)');
  }

  if (!response.usage || typeof response.usage !== 'object') {
    throw new Error('AI response must have a "usage" field (object)');
  }

  if (typeof response.usage.promptTokens !== 'number' || response.usage.promptTokens < 0) {
    throw new Error('AI response usage must have valid "promptTokens" (non-negative number)');
  }

  if (typeof response.usage.completionTokens !== 'number' || response.usage.completionTokens < 0) {
    throw new Error('AI response usage must have valid "completionTokens" (non-negative number)');
  }

  return true;
}

/**
 * Validate extracted data structure
 * @param {string} jsonString - JSON string to parse and validate
 * @param {Object} expectedStructure - Expected structure (keys and types)
 * @returns {Object} Parsed and validated object
 * @throws {Error} With detailed message if invalid
 */
export function validateAndParseJSON(jsonString, context = '') {
  if (!jsonString || typeof jsonString !== 'string') {
    throw new Error(`${context}: Expected JSON string, got empty or non-string value`);
  }

  try {
    return JSON.parse(jsonString);
  } catch (err) {
    throw new Error(
      `${context}: Failed to parse JSON response\n` +
      `Response: ${jsonString.substring(0, 200)}${jsonString.length > 200 ? '...' : ''}\n` +
      `Error: ${err.message}`
    );
  }
}

/**
 * Create a user-friendly error message for AI response parsing failures
 * @param {string} operation - What operation failed (e.g., "task parsing")
 * @param {string} response - The response that failed
 * @param {Error} originalError - The original error
 * @returns {string} User-friendly error message
 */
export function createParseErrorMessage(operation, response, originalError) {
  return (
    `Failed to parse ${operation}.\n` +
    `The AI model returned invalid JSON.\n\n` +
    `Model response: ${response?.substring(0, 300) || 'empty'}${response?.length > 300 ? '...' : ''}\n\n` +
    `Error details: ${originalError.message}\n\n` +
    `Suggestions:\n` +
    `- Try rephrasing your prompt more clearly\n` +
    `- Ensure the AI provider has sufficient context\n` +
    `- Check that the page content is accessible to the model`
  );
}

/**
 * Validate browser configuration
 * @param {Object} config - Browser configuration
 * @returns {Object} Validated and normalized config
 * @throws {Error} If config is invalid
 */
export function validateBrowserConfig(config) {
  const validated = { ...config };

  if (validated.headless !== undefined && typeof validated.headless !== 'boolean') {
    throw new Error('Browser config "headless" must be a boolean');
  }

  if (validated.slowMo !== undefined && typeof validated.slowMo !== 'number') {
    throw new Error('Browser config "slowMo" must be a number (milliseconds)');
  }

  if (validated.timeout !== undefined && typeof validated.timeout !== 'number') {
    throw new Error('Browser config "timeout" must be a number (milliseconds)');
  }

  return validated;
}

/**
 * Create a detailed error context string for logging
 * @param {string} stage - What stage of execution (e.g., "instruction execution")
 * @param {Object} context - Contextual data
 * @returns {string} Formatted context string
 */
export function createErrorContext(stage, context = {}) {
  const parts = [`[${stage}]`];

  if (context.instructionIndex !== undefined) {
    parts.push(`Instruction #${context.instructionIndex}`);
  }

  if (context.instructionName) {
    parts.push(`(${context.instructionName})`);
  }

  if (context.url) {
    parts.push(`URL: ${context.url}`);
  }

  return parts.join(' ');
}
