/**
 * `idx snap <url>` — on-demand DOM inspection subcommand.
 *
 * Flags:
 *   --aria           show ariaSnapshot output (ARIA YAML tree) instead of DOM JSON
 *   -i               interactive only:
 *                      dom mode  → nodes with xpath index
 *                      aria mode → lines with role + non-empty name
 *   -a               annotated screenshot → /tmp/idx-dom-annotated.png (dom mode only)
 *   -d <N>           depth limit: truncate DOM tree at depth N (dom mode only)
 *   -s <selector>    scope to CSS selector subtree (dom mode only)
 *
 * Output:
 *   dom mode  → simplified DOM JSON to stdout, header: === DOM Tree ===
 *   aria mode → ariaSnapshot YAML to stdout,  header: === ARIA Snapshot ===
 * With -a (dom): writes PNG and prints path to stderr.
 */

import { chromium } from 'playwright';
import { DomSimplifier } from '../DomSimplifier.js';
import logger from '../utils/logger.js';

/**
 * Parse argv flags for the snap subcommand.
 * Expected: process.argv starting after 'snap' token.
 * @param {string[]} args
 * @returns {{
 *   url: string,
 *   aria: boolean,
 *   interactive: boolean,
 *   annotated: boolean,
 *   depth: number|null,
 *   selector: string|null,
 * }}
 */
export function parseDomArgs(args) {
  const opts = {
    url: null,
    aria: false,
    interactive: false,
    annotated: false,
    depth: null,
    selector: null,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--aria') {
      opts.aria = true;
    } else if (arg === '-i') {
      opts.interactive = true;
    } else if (arg === '-a') {
      opts.annotated = true;
    } else if (arg === '-d') {
      const n = parseInt(args[i + 1], 10);
      if (isNaN(n)) throw new Error(
        '-d requires a numeric depth argument (e.g. -d 5). ' +
        'Depth controls how many DOM levels are included in the output.'
      );
      opts.depth = n;
      i++;
    } else if (arg === '-s') {
      if (!args[i + 1]) throw new Error(
        '-s requires a CSS selector argument (e.g. -s "#main-content"). ' +
        'Scope the DOM output to the subtree rooted at the matching element.'
      );
      opts.selector = args[i + 1];
      i++;
    } else if (!opts.url && !arg.startsWith('-')) {
      opts.url = arg;
    }
    i++;
  }

  if (!opts.url) throw new Error(
    'snap subcommand requires a URL argument. ' +
    'Usage: idx snap <url> [flags]. ' +
    'Example: idx snap https://example.com -i'
  );
  return opts;
}

/**
 * Filter ariaSnapshot lines to only those with a role and non-empty name.
 * Keeps indented structure lines that belong to named roles.
 * @param {string} ariaYaml
 * @returns {string}
 */
function filterAriaInteractive(ariaYaml) {
  const lines = ariaYaml.split('\n');
  // Keep lines that have: "- role 'name'" pattern (role + quoted name)
  const kept = lines.filter(line => {
    const m = line.match(/^\s*-\s+(\w[\w-]*)\s+'([^']+)'/);
    return m && m[2].trim().length > 0;
  });
  return kept.join('\n');
}

/**
 * Inject overlay boxes around all indexed DOM elements and take a screenshot.
 * @param {import('playwright').Page} page
 * @param {string[]} xpaths
 * @param {string} outPath
 */
async function takeAnnotatedScreenshot(page, xpaths, outPath) {
  await page.evaluate((paths) => {
    const style = document.createElement('style');
    style.id = '__idx_overlay_style';
    style.textContent = `
      .__idx_annotated {
        outline: 2px solid rgba(255, 80, 0, 0.8) !important;
        position: relative;
      }
    `;
    document.head.appendChild(style);

    const byXPath = (xpath) => {
      try {
        return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
          .singleNodeValue;
      } catch (_) {
        return null;
      }
    };

    for (const xpath of paths) {
      const el = byXPath(xpath);
      if (el && el instanceof HTMLElement) {
        el.classList.add('__idx_annotated');
      }
    }
  }, xpaths);

  await page.screenshot({ path: outPath, fullPage: false });

  await page.evaluate(() => {
    document.getElementById('__idx_overlay_style')?.remove();
    for (const el of document.querySelectorAll('.__idx_annotated')) {
      el.classList.remove('__idx_annotated');
    }
  });
}

/**
 * Main entry point for `idx snap <url>` subcommand.
 * @param {string[]} args - argv after 'snap' token
 * @param {Object} browserConfig
 */
export async function runDomCommand(args, browserConfig = {}) {
  const opts = parseDomArgs(args);

  const browser = await chromium.launch({
    headless: true,
    ...browserConfig,
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    logger.debug('snap: navigating', { url: opts.url });
    await page.goto(opts.url, { waitUntil: 'networkidle' });

    if (opts.aria) {
      // ── ARIA mode ──────────────────────────────────────────────────────────
      process.stdout.write('=== ARIA Snapshot ===\n');
      let ariaYaml = await page.locator('body').ariaSnapshot();

      if (opts.interactive) {
        ariaYaml = filterAriaInteractive(ariaYaml);
      }

      process.stdout.write(ariaYaml + '\n');
    } else {
      // ── DOM mode ───────────────────────────────────────────────────────────
      process.stdout.write('=== DOM Tree ===\n');

      const simplifier = new DomSimplifier(page, {
        selector: opts.selector,
        maxDepth: opts.depth,
      });

      const domTree = await simplifier.simplify();

      let output = domTree;
      if (opts.interactive) {
        output = filterInteractive(domTree, simplifier.xpaths);
      }

      const json = simplifier.stringifySimplifiedDom(output);

      if (opts.annotated) {
        const outPath = '/tmp/idx-dom-annotated.png';
        await takeAnnotatedScreenshot(page, simplifier.xpaths, outPath);
        process.stderr.write(`Annotated screenshot: ${outPath}\n`);
      }

      process.stdout.write(json + '\n');
    }
  } finally {
    await browser.close();
  }
}

/**
 * Recursively keep only nodes that have a non-empty tag (interactive-ish).
 * Strips pure text/structure nodes without meaningful interaction potential.
 * @param {Object} node
 * @param {string[]} xpaths
 * @returns {Object}
 */
function filterInteractive(node, xpaths) {
  if (!node) return null;

  const INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL',
    'DETAILS', 'SUMMARY', 'FORM', 'OPTION',
  ]);

  const isInteractive = INTERACTIVE_TAGS.has(node.n) ||
    (node.a && (node.a['aria-label'] || node.a['role']));

  const filteredChildren = (node.c || [])
    .map(child => filterInteractive(child, xpaths))
    .filter(Boolean);

  if (!isInteractive && filteredChildren.length === 0) return null;

  return { ...node, c: filteredChildren };
}
