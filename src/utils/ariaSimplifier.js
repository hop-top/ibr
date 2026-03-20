/**
 * ariaSimplifier — Playwright ariaSnapshot-based page representation
 * Replaces DomSimplifier for page context fed to AI.
 */

import logger from './logger.js';

export const SIZE_THRESHOLD = 50_000;

/**
 * Get ARIA snapshot of current page body.
 * Returns null if ariaSnapshot not available (Playwright version too old).
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
export async function getSnapshot(page) {
  try {
    const snapshot = await page.locator('body').ariaSnapshot();
    return snapshot;
  } catch (err) {
    logger.warn('ariaSnapshot failed', { error: err.message });
    return null;
  }
}

/**
 * Resolve a descriptor {role, name} (or {text} / {label} / {placeholder}) to
 * a Playwright locator using the preferred ARIA locator chain.
 *
 * Priority:
 *   1. getByRole(role, {name})   — preferred
 *   2. getByLabel(name)          — form inputs with labels
 *   3. getByText(text)           — visible text fallback
 *   4. getByPlaceholder(text)    — input placeholder fallback
 *
 * @param {import('playwright').Page} page
 * @param {Object} descriptor
 * @param {string} [descriptor.role]
 * @param {string} [descriptor.name]
 * @param {string} [descriptor.text]
 * @param {string} [descriptor.label]
 * @param {string} [descriptor.placeholder]
 * @returns {import('playwright').Locator|null}
 */
export function resolveElement(page, descriptor) {
  if (!descriptor) return null;

  const { role, name, text, label, placeholder } = descriptor;

  // 1. role + name
  if (role && name) {
    return page.getByRole(role, { name });
  }

  // 2. role alone
  if (role) {
    return page.getByRole(role);
  }

  // 3. label
  if (label) {
    return page.getByLabel(label);
  }

  // 4. name as label (AI may return {name} without role)
  if (name) {
    return page.getByLabel(name);
  }

  // 5. visible text
  if (text) {
    return page.getByText(text);
  }

  // 6. placeholder
  if (placeholder) {
    return page.getByPlaceholder(placeholder);
  }

  return null;
}

export default { getSnapshot, resolveElement, SIZE_THRESHOLD };
