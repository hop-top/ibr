/**
 * Cache utility functions
 * Handles DOM signatures and cache validation
 */

import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Create a structural signature from a page context string.
 * Supports both ARIA snapshot strings and DOM JSON strings (DomSimplifier output).
 *
 * - ARIA snapshot: extracts role tokens only (strips names for stability).
 * - DOM JSON: hashes the full string (structure is already stable).
 *
 * @param {string} pageContext
 * @returns {string|null}
 */
export function createDomSignature(pageContext) {
  try {
    if (!pageContext || typeof pageContext !== 'string') return null;

    // Detect DOM JSON mode: DomSimplifier outputs a JSON object/array string.
    const trimmed = pageContext.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      // Hash entire DOM string — structure is already normalised by DomSimplifier.
      return crypto.createHash('sha256').update(pageContext).digest('hex');
    }

    // ARIA snapshot mode: extract structural lines (role tokens only, strip names).
    const structuralLines = pageContext
      .split('\n')
      .map(line => {
        // Keep indentation + role token only (drop the name part for stability)
        const m = line.match(/^(\s*-\s+\w[\w-]*)/);
        return m ? m[1] : line.match(/^\s*$/) ? null : line.replace(/:\s+.+$/, ':');
      })
      .filter(Boolean)
      .join('\n');

    return crypto.createHash('sha256').update(structuralLines).digest('hex');
  } catch (error) {
    logger.debug('Failed to create page signature', { error: error.message });
    return null;
  }
}

/**
 * Check if DOM signature is compatible (similar enough)
 * Returns true if signatures are the same or very similar
 */
export function isDomCompatible(oldSignature, newSignature) {
  if (!oldSignature || !newSignature) {
    return true; // If no signature, assume compatible
  }

  // Exact match
  if (oldSignature === newSignature) {
    return true;
  }

  // For now, consider incompatible if different
  // Could add fuzzy matching here if needed
  return false;
}

/**
 * Validate that a find result is still valid
 * Checks if elements still exist in current DOM
 */
export function validateFindResult(result) {
  return Array.isArray(result) && result.length > 0;
}

/**
 * Validate that an action result is still valid
 */
export function validateActionResult(result) {
  return (
    result &&
    typeof result === 'object' &&
    Array.isArray(result.elements) &&
    result.elements.length > 0 &&
    result.type
  );
}

/**
 * Validate that an extract result is still valid
 */
export function validateExtractResult(result) {
  return Array.isArray(result) && result.length > 0;
}

/**
 * Get validator for result type
 */
export function getValidator(type) {
  switch (type) {
    case 'find':
      return validateFindResult;
    case 'action':
      return validateActionResult;
    case 'extract':
      return validateExtractResult;
    default:
      return () => false;
  }
}

/**
 * Normalise a single element descriptor for caching.
 * Preserves ARIA {role,name} when present; falls back to DOM {x} index.
 * @param {Object} el
 * @returns {Object}
 */
function normaliseDescriptor(el) {
  if (el.role || el.name) return { role: el.role, name: el.name };
  if (typeof el.x === 'number') return { x: el.x };
  return null;
}

/**
 * Extract cached schema from AI response.
 * Supports both ARIA {role,name} and DOM {x} descriptor shapes.
 */
export function extractSchema(type, result) {
  try {
    switch (type) {
      case 'find':
        return {
          elementDescriptors: result
            .map(normaliseDescriptor)
            .filter(Boolean)
        };

      case 'action':
        return {
          elementDescriptors: result.elements
            .map(normaliseDescriptor)
            .filter(Boolean),
          actionType: result.type,
          actionValue: result.value || null
        };

      case 'extract':
        // For extract, we don't cache the actual results, just that extraction worked
        return {
          extractionType: 'array',
          itemCount: result.length
        };

      default:
        return null;
    }
  } catch (error) {
    logger.debug('Failed to extract schema', { type, error: error.message });
    return null;
  }
}

export default {
  createDomSignature,
  isDomCompatible,
  validateFindResult,
  validateActionResult,
  validateExtractResult,
  getValidator,
  extractSchema
};
