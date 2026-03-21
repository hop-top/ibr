/**
 * BAML-based response parser for structured AI outputs
 * Handles flexible parsing of responses that may be wrapped in markdown, JSON, or plain text
 */

import logger from '../utils/logger.js';

/**
 * Attempt to extract and parse JSON from various formats
 * @param {string} response - Raw AI response
 * @param {string} expectedType - Type of response expected (task, find, action, extract)
 * @returns {Object} Parsed and validated response object
 */
export function parseWithBAML(response, expectedType = 'generic') {
  if (!response || typeof response !== 'string' || response.trim() === '') {
    let gotDescription;
    if (response === '') {
      gotDescription = 'an empty string ("")';
    } else if (typeof response === 'string' && response.trim() === '') {
      gotDescription = 'a whitespace-only string';
    } else if (response === null) {
      gotDescription = 'null';
    } else {
      gotDescription = typeof response;
    }
    throw new Error(
      'BAML parser: Invalid response format — expected a non-empty string but got ' +
      gotDescription + '. ' +
      'This usually means the AI provider returned an empty or non-text response. ' +
      'Check AI_PROVIDER, AI_MODEL, and that the API key is valid.'
    );
  }

  const cleaned = response.trim();

  // Try different parsing strategies in order of likelihood

  // Strategy 1: Plain JSON (no wrapper)
  try {
    const json = JSON.parse(cleaned);
    logger.debug('BAML parser: Successfully parsed as plain JSON', { type: expectedType });
    return json;
  } catch (e) {
    // Not plain JSON, continue to next strategy
  }

  // Strategy 2: Markdown-wrapped JSON (```json ... ```)
  try {
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[1].trim());
      logger.debug('BAML parser: Successfully parsed markdown-wrapped JSON', { type: expectedType });
      return json;
    }
  } catch (e) {
    // Not markdown-wrapped JSON, continue to next strategy
  }

  // Strategy 3: JSON with extra text before/after
  try {
    const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      const json = JSON.parse(jsonMatch[1].trim());
      logger.debug('BAML parser: Successfully parsed JSON with surrounding text', { type: expectedType });
      return json;
    }
  } catch (e) {
    // Not valid JSON with surrounding text
  }

  // Strategy 4: Try to extract JSON from code blocks (```...```)
  try {
    const codeMatch = cleaned.match(/```([\s\S]*?)```/);
    if (codeMatch) {
      const content = codeMatch[1].trim();
      // Remove language specifier if present
      const jsonContent = content.replace(/^[a-z]+\n/, '');
      const json = JSON.parse(jsonContent);
      logger.debug('BAML parser: Successfully parsed JSON from code block', { type: expectedType });
      return json;
    }
  } catch (e) {
    // Not valid code block JSON
  }

  // Strategy 5: Try to parse as JSONL (newline-delimited JSON) for arrays
  try {
    if (cleaned.startsWith('[') || cleaned.split('\n').length > 1) {
      // Try as array of objects
      const lines = cleaned.split('\n').filter(line => line.trim());
      const objects = lines.map(line => JSON.parse(line));
      logger.debug('BAML parser: Successfully parsed as JSONL format', { type: expectedType });
      return objects.length === 1 ? objects[0] : { data: objects };
    }
  } catch (e) {
    // Not JSONL format
  }

  // Strategy 6: Extract array items from markdown lists (for extraction results)
  if (expectedType === 'extraction' || expectedType === 'find_elements') {
    try {
      // Look for markdown list items or numbered list
      const listItems = [];
      const lines = cleaned.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Match markdown list items (- item or * item) or numbered list (1. item)
        const match = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
        if (match) {
          listItems.push(match[1].trim());
        }
      }

      if (listItems.length > 0) {
        logger.debug('BAML parser: Successfully parsed as markdown list', { type: expectedType, itemCount: listItems.length });
        return listItems;
      }
    } catch (e) {
      // Not a markdown list
    }
  }

  // All strategies failed
  logger.warn('BAML parser: Unable to parse response with any strategy', {
    type: expectedType,
    responsePreview: cleaned.substring(0, 100)
  });

  throw new Error(
    `BAML parser: Unable to extract JSON from "${expectedType}" response after trying all strategies ` +
    `(plain JSON, markdown code block, embedded JSON, JSONL, markdown list). ` +
    `The AI may have responded in an unexpected format. ` +
    `Try lowering AI_TEMPERATURE or switching AI_MODEL. ` +
    `Response preview: ${cleaned.substring(0, 200)}${cleaned.length > 200 ? '...' : ''}`
  );
}

/**
 * Parse task description response
 * @param {string} response - Raw AI response
 * @returns {Object} {url: string, instructions: array}
 */
export function parseTaskDescriptionResponse(response) {
  try {
    const parsed = parseWithBAML(response, 'task_description');

    // Validate required fields
    if (!parsed.url) {
      throw new Error(
        'Task description missing required field: "url". ' +
        'The prompt must specify a URL for ibr to navigate to. ' +
        'Example prompt: "url: https://example.com\\ninstructions:\\n  - click submit".'
      );
    }
    if (!Array.isArray(parsed.instructions)) {
      throw new Error(
        'Task description missing required field: "instructions" (must be an array). ' +
        'Ensure the prompt includes a list of step-by-step instructions. ' +
        'Example: "instructions:\\n  - click the login button\\n  - fill the email field".'
      );
    }

    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse task description: ${error.message} ` +
      `Verify the prompt format and that the AI model returned structured JSON. ` +
      `Run with a lower AI_TEMPERATURE (e.g. 0) to reduce response variability.`
    );
  }
}

/**
 * Parse find elements response
 * @param {string} response - Raw AI response
 * @returns {Array} Array of matching elements
 */
export function parseFindElementsResponse(response) {
  try {
    const parsed = parseWithBAML(response, 'find_elements');

    // Normalize to array
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed.elements && Array.isArray(parsed.elements)) {
      return parsed.elements;
    }

    logger.warn('Find elements response not in expected format, treating as empty array', { parsed });
    return [];
  } catch (error) {
    logger.warn(`Failed to parse find elements response: ${error.message}`);
    return []; // Return empty array on failure for graceful degradation
  }
}

/**
 * Parse action instruction response
 * @param {string} response - Raw AI response
 * @returns {Object} {elements: array, type: string, value?: string}
 */
export function parseActionInstructionResponse(response) {
  try {
    const parsed = parseWithBAML(response, 'action_instruction');

    // Validate and normalize
    const result = {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      type: parsed.type || 'click',
      value: parsed.value || undefined
    };

    return result;
  } catch (error) {
    throw new Error(
      `Failed to parse action instruction: ${error.message} ` +
      `Expected response format: {"elements":[...],"type":"click|fill|type|press","value":"..."}. ` +
      `Run "ibr snap <url> -i" to see available elements and retry with a more specific prompt.`
    );
  }
}

/**
 * Parse extraction response
 * @param {string} response - Raw AI response
 * @returns {Array} Array of extracted data
 */
export function parseExtractionResponse(response) {
  try {
    const parsed = parseWithBAML(response, 'extraction');

    // Normalize to array
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed.data && Array.isArray(parsed.data)) {
      return parsed.data;
    }

    logger.warn('Extraction response not in expected array format', { parsed });
    return [];
  } catch (error) {
    logger.warn(`Failed to parse extraction response: ${error.message}`);
    return []; // Return empty array on failure for graceful degradation
  }
}

export default {
  parseWithBAML,
  parseTaskDescriptionResponse,
  parseFindElementsResponse,
  parseActionInstructionResponse,
  parseExtractionResponse
};
