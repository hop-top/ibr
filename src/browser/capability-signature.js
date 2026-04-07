/**
 * Capability signature canonicalization.
 *
 * sha256(canonicalize({ opKind, selector, stepTemplate })) — see spec
 * §"Signature canonical form" for exact rules.
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0031
 */

import crypto from 'crypto';

/** Closed enum of operation kinds the manifest can record. */
export const OP_KINDS = Object.freeze([
  'click',
  'fill',
  'goto',
  'evaluate',
  'screenshot',
  'ariaSnap',
  'domSnap',
  'boundingBox',
  'content',
  // Launch-time failures recorded by the resolver fallback wrapper.
  // See resolver.js [SECTION: CAPABILITY] for the (coarser) launch
  // signature semantics.
  'launch',
]);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'is', 'be',
]);

/**
 * Normalize a free-form natural-language step template into a canonical
 * bag-of-words string. Steps:
 *   1. lowercase
 *   2. strip URLs
 *   3. strip numbers
 *   4. strip single- and double-quoted strings
 *   5. split on whitespace, drop stopwords
 *   6. sort alphabetically
 *   7. rejoin with single space
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeStepTemplate(text) {
  if (text == null) return '';
  let s = String(text).toLowerCase();
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/\d+/g, ' ');
  s = s.replace(/['"][^'"]*['"]/g, ' ');
  const words = s
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
  words.sort();
  return words.join(' ');
}

/**
 * Validate + canonicalize a structural selector descriptor. Callers MUST
 * pass the structural form (already extracted from a Playwright locator
 * or similar). Raw CSS/XPath strings are not parsed here.
 *
 * @param {object} raw
 * @returns {{ role: string|null, tagName: string, hasText: boolean, depth: number }}
 */
export function canonicalSelector(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('capability-signature: selector must be a structural object');
  }
  const { role, tagName, hasText, depth } = raw;
  if (typeof tagName !== 'string' || tagName.length === 0) {
    throw new Error('capability-signature: selector.tagName must be a non-empty string');
  }
  if (typeof hasText !== 'boolean') {
    throw new Error('capability-signature: selector.hasText must be a boolean');
  }
  if (!Number.isInteger(depth)) {
    throw new Error('capability-signature: selector.depth must be an integer');
  }
  if (role != null && typeof role !== 'string') {
    throw new Error('capability-signature: selector.role must be a string or null');
  }
  return {
    role: role ?? null,
    tagName,
    hasText,
    depth,
  };
}

/**
 * Recursively sort object keys to produce a deterministic JSON serialization.
 * Arrays are preserved in order; objects have keys sorted alphabetically at
 * every nesting level.
 *
 * @param {*} value
 * @returns {*}
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalize(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * Compute a deterministic capability signature.
 *
 * @param {object} args
 * @param {string} args.opKind        one of OP_KINDS
 * @param {object} args.selector      structural selector descriptor
 * @param {string} args.stepTemplate  free-form natural-language step
 * @returns {string}                  "sha256:<hex>"
 */
export function signature({ opKind, selector, stepTemplate }) {
  if (!OP_KINDS.includes(opKind)) {
    throw new Error(
      `capability-signature: unknown opKind "${opKind}"; must be one of ${OP_KINDS.join(', ')}`,
    );
  }
  const canonicalObj = {
    opKind,
    selector: canonicalSelector(selector),
    stepTemplate: normalizeStepTemplate(stepTemplate),
  };
  const json = JSON.stringify(canonicalize(canonicalObj));
  const hex = crypto.createHash('sha256').update(json).digest('hex');
  return `sha256:${hex}`;
}
