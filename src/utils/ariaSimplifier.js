/**
 * ariaSimplifier — Playwright ariaSnapshot-based page representation
 * Includes quality assessment + mode selection logic.
 */

import logger from './logger.js';

export const SIZE_THRESHOLD = 50_000;
export const SPARSITY_THRESHOLD = 0.4;

// Roles considered interactive (must have a name to be useful)
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab',
  'treeitem', 'gridcell',
]);

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
 * Assess quality of an ARIA snapshot.
 * Parses role/name lines and counts unnamed interactive elements.
 *
 * @param {string|null} snapshot
 * @returns {{ sparsityRatio: number, tooLarge: boolean, empty: boolean }}
 */
export function assessQuality(snapshot) {
  if (!snapshot || snapshot.trim().length === 0) {
    return { sparsityRatio: 0, tooLarge: false, empty: true };
  }

  if (snapshot.length > SIZE_THRESHOLD) {
    return { sparsityRatio: 0, tooLarge: true, empty: false };
  }

  // Lines look like: `- button "Sign in"` or `- button`
  // role pattern: starts with optional whitespace + `- <role>`
  const lineRe = /^\s*-\s+(\w[\w-]*)(?:\s+"([^"]*)")?/;

  let total = 0;
  let unnamed = 0;

  for (const line of snapshot.split('\n')) {
    const m = line.match(lineRe);
    if (!m) continue;
    const role = m[1].toLowerCase();
    if (!INTERACTIVE_ROLES.has(role)) continue;
    total++;
    // unnamed = no name capture OR empty string name
    if (!m[2] || m[2].trim() === '') unnamed++;
  }

  const sparsityRatio = total === 0 ? 0 : unnamed / total;
  return { sparsityRatio, tooLarge: false, empty: false };
}

/**
 * Select aria or dom mode based on snapshot quality + optional forced mode.
 *
 * @param {string|null} snapshot
 * @param {'aria'|'dom'|'auto'} [forcedMode='auto']
 * @returns {{ mode: 'aria'|'dom', reason: string }}
 */
export function selectMode(snapshot, forcedMode = 'auto') {
  if (forcedMode === 'aria') return { mode: 'aria', reason: 'forced' };
  if (forcedMode === 'dom')  return { mode: 'dom',  reason: 'forced' };

  // auto
  if (!snapshot || snapshot.trim().length === 0) {
    return { mode: 'dom', reason: 'empty' };
  }

  if (snapshot.length > SIZE_THRESHOLD) {
    return { mode: 'dom', reason: 'size' };
  }

  const { sparsityRatio } = assessQuality(snapshot);
  if (sparsityRatio > SPARSITY_THRESHOLD) {
    return { mode: 'dom', reason: `sparse (${sparsityRatio.toFixed(2)})` };
  }

  return { mode: 'aria', reason: 'quality ok' };
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
 * @returns {import('playwright').Locator|null}
 */
export function resolveElement(page, descriptor) {
  if (!descriptor) return null;

  const { role, name, text, label, placeholder } = descriptor;

  if (role && name) return page.getByRole(role, { name });
  if (role)         return page.getByRole(role);
  if (label)        return page.getByLabel(label);
  if (name)         return page.getByLabel(name);
  if (text)         return page.getByText(text);
  if (placeholder)  return page.getByPlaceholder(placeholder);

  return null;
}

export default { getSnapshot, assessQuality, selectMode, resolveElement, SIZE_THRESHOLD, SPARSITY_THRESHOLD };
