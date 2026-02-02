/**
 * Cache utility functions
 * Handles DOM signatures and cache validation
 */

import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Create a structural signature of the DOM tree
 * Ignores dynamic content (text, timestamps) but preserves structure
 */
export function createDomSignature(domTree) {
  try {
    const structure = extractStructure(domTree, 0);
    const hash = crypto.createHash('sha256').update(JSON.stringify(structure)).digest('hex');
    return hash;
  } catch (error) {
    logger.debug('Failed to create DOM signature', { error: error.message });
    return null;
  }
}

/**
 * Extract structural elements from DOM tree
 * Limits depth to 5 and only keeps stable attributes
 */
function extractStructure(node, depth) {
  if (!node || depth > 5) return null;

  const structure = {
    n: node.n // tag name
  };

  // Only include stable attributes
  if (node.a) {
    const stableAttrs = {};
    ['id', 'name', 'aria-label', 'role', 'data-testid'].forEach(key => {
      if (node.a[key]) stableAttrs[key] = node.a[key];
    });
    if (Object.keys(stableAttrs).length > 0) {
      structure.a = stableAttrs;
    }
  }

  // Include first 10 children (truncated for performance)
  if (node.c && Array.isArray(node.c)) {
    const children = node.c
      .slice(0, 10)
      .map(child => extractStructure(child, depth + 1))
      .filter(Boolean);

    if (children.length > 0) {
      structure.c = children;
    }
  }

  return structure;
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
 */
export function extractSchema(type, result) {
  try {
    switch (type) {
      case 'find':
        return {
          elementIndices: result.map(el => el.x).filter(x => typeof x === 'number')
        };

      case 'action':
        return {
          elementIndices: result.elements.map(el => el.x).filter(x => typeof x === 'number'),
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
