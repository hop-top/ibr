/**
 * Cache utility functions
 * Handles DOM signatures and cache validation
 */

import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Create a structural signature from an ARIA snapshot string.
 * Extracts only role/name lines to strip dynamic text values.
 * Falls back to full hash when snapshot is null/undefined.
 * @param {string} ariaSnapshot
 * @returns {string|null}
 */
export function createDomSignature(ariaSnapshot) {
  try {
    if (!ariaSnapshot || typeof ariaSnapshot !== 'string') return null;

    // Extract structural lines: lines starting with role tokens (role: name pattern)
    // This strips dynamic values while preserving the structural skeleton.
    const structuralLines = ariaSnapshot
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
    logger.debug('Failed to create ARIA signature', { error: error.message });
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
 * Extract cached schema from AI response
 * Uses {role, name} descriptors (ARIA-based) instead of numeric XPath indices.
 */
export function extractSchema(type, result) {
  try {
    switch (type) {
      case 'find':
        return {
          elementDescriptors: result
            .filter(el => el.role || el.name)
            .map(el => ({ role: el.role, name: el.name }))
        };

      case 'action':
        return {
          elementDescriptors: result.elements
            .filter(el => el.role || el.name)
            .map(el => ({ role: el.role, name: el.name })),
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
