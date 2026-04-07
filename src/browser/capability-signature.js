/**
 * Capability signature canonicalization.
 *
 * sha256(canonicalize({ opKind, selector, stepTemplate })) — see spec
 * §"Signature canonical form" for exact rules.
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0031
 */

// TODO(T-0031)
export function signature({ opKind, selector, stepTemplate }) {
  throw new Error('src/browser/capability-signature.js not yet implemented');
}

// TODO(T-0031)
export function normalizeStepTemplate(text) {
  throw new Error('capability-signature.js#normalizeStepTemplate not yet implemented');
}
