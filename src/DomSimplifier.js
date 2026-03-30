import { parse, HTMLElement, NodeType } from 'node-html-parser';
import { generateElementXPath } from './utils/xpathUtils.js';
import { PSEUDO_BUTTON_LIMIT, PSEUDO_BUTTON_TEXT_MAX_LENGTH, STANDARD_INTERACTIVE_TAGS } from './utils/constants.js';

export class DomSimplifier {
  /**
   * @param {import('playwright').Page} page
   * @param {Object} [opts]
   * @param {string|null} [opts.selector] - CSS selector to scope DOM to
   * @param {number|null} [opts.maxDepth] - Max depth of DOM tree (null = unlimited)
   */
  constructor(page, opts = {}) {
    this.page = page;
    this.xpaths = [];
    this.selector = opts.selector || null;
    this.maxDepth = opts.maxDepth != null ? opts.maxDepth : null;
  }

  async simplify() {
    let html;
    let parentXPath = '';
    if (this.selector) {
      // Compute absolute XPath of the scoped root in the live document so
      // generated child XPaths remain absolute and work with document.evaluate().
      const result = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { html: document.documentElement.outerHTML, xpath: '' };
        // Walk up the live DOM to build absolute XPath prefix
        const parts = [];
        let node = el;
        while (node && node.nodeType === 1) {
          const tag = node.tagName;
          const siblings = Array.from(node.parentNode?.children || [])
            .filter(c => c.tagName === tag);
          const siblingSuffix = siblings.length > 1 ? `[${siblings.indexOf(node) + 1}]` : '';
          parts.unshift(`${tag}${siblingSuffix}`);
          node = node.parentNode;
          if (node === document.documentElement.parentNode) break;
        }
        return { html: el.outerHTML, xpath: '/' + parts.join('/') };
      }, this.selector);
      html = result.html;
      // parentXPath for the scoped root = its absolute path minus the root tag
      // (the #simplifyDomTree will append /TAG itself, so we use the parent path)
      parentXPath = result.xpath.replace(/\/[^/]+$/, '');
    } else {
      html = await this.page.content();
    }
    const root = parse(html);
    this.xpaths = [];
    return this.#simplifyDomTree(root.children[0], parentXPath);
  }

  /**
   * Simplifies the DOM tree by removing non-essential elements and attributes
   * @param {HTMLElement} element - The element to simplify
   * @param {string} parentXPath - The XPath of the parent element (default: empty string)
   * @param {number} depth - Current depth (default: 0)
   * @returns {Object} The simplified DOM tree
   */
  #simplifyDomTree(element, parentXPath = "", depth = 0) {
    const filteredChildren = element.children.filter((child) => {
      return !["SCRIPT", "STYLE", "BROWSER-FONT-SIZE", "SVG", "LINK", "NOSCRIPT"].includes(child.tagName);
    });

    const filteredAttributes = Object.keys(element.attributes).reduce((acc, key) => {
      if (["id", "href", "src", "alt", "title", "aria-label", "role", "name", "content", "data-ibr-ref"].includes(key)) {
        acc[key] = element.attributes[key];
      }
      return acc;
    }, {});

    const text = element.childNodes.reduce((acc, child) => {
      if (child.nodeType === NodeType.TEXT_NODE) {
        acc += child.textContent;
      }
      return acc;
    }, "");

    const xPath = generateElementXPath(parentXPath, element);
    const xPathIdx = this.xpaths.push(xPath) - 1;

    // Inject data-ibr-ref into standard interactive elements during tree walk
    // (Note: this modifies the input HTMLElement if it's from node-html-parser,
    // but simplified DOM works on its own objects).
    if (STANDARD_INTERACTIVE_TAGS.includes(element.tagName)) {
      element.setAttribute('data-ibr-ref', String(xPathIdx));
    }

    // Respect maxDepth: stop recursing children beyond limit
    const atLimit = this.maxDepth !== null && depth >= this.maxDepth;

    const simplifiedElement = {
      x: xPathIdx,
      n: element.tagName,
      t: text,
      a: filteredAttributes,
      c: atLimit ? [] : filteredChildren.map((child) => {
        if (child instanceof HTMLElement) {
          return this.#simplifyDomTree(child, xPath, depth + 1);
        }
        return child;
      }),
    };

    return simplifiedElement;
  }

  /**
   * Converts a simplified DOM tree to a compact JSON string
   * @param {Object} simplifiedDomTree - The simplified DOM tree
   * @returns {string} A compact JSON string representation of the DOM tree
   */
  stringifySimplifiedDom(simplifiedDomTree) {
    return JSON.stringify(simplifiedDomTree)
      .replaceAll(/,+"t":""/g, "")
      .replaceAll(/,+"c":\[\]/g, "")
      .replaceAll(/,+"a":\{\}/g, "");
  }

  /**
   * Injects data-ibr-ref attributes onto standard interactive elements.
   * This allows AnnotationService to resolve them even if they are not pseudo-buttons.
   * @param {Page} page - Playwright page instance
   * @param {string[]} xpaths - The list of xpaths generated during simplify()
   */
  async injectAttributes(page, xpaths) {
    try {
      await page.evaluate(({ xpaths, standardTags }) => {
        xpaths.forEach((xpath, i) => {
          try {
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const el = result.singleNodeValue;
            if (el && el.nodeType === 1 && standardTags.includes(el.tagName)) {
              el.setAttribute('data-ibr-ref', String(i));
            }
          } catch {
            // skip invalid xpaths or missing elements
          }
        });
      }, { xpaths, standardTags: STANDARD_INTERACTIVE_TAGS });
    } catch (err) {
      // non-fatal
    }
  }

  /**
   * Scans the page for pseudo-interactive elements (not standard interactive tags)
   * that have cursor:pointer, onclick attr, or tabindex >= 0.
   * @param {Page} page - Playwright page instance
   * @returns {Promise<Array>} Array of pseudo-button descriptors
   */
  async extractPseudoButtons(page) {
    try {
      return await page.evaluate(
        ({ limit, maxLen, standardTags }) => {
          function cssPath(el) {
            const parts = [];
            let node = el;
            while (node && node.nodeType === Node.ELEMENT_NODE) {
              let siblingIndex = 1;
              let sib = node.previousElementSibling;
              while (sib) { siblingIndex++; sib = sib.previousElementSibling; }
              parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${siblingIndex})`);
              node = node.parentElement;
            }
            return parts.join(' > ');
          }

          const results = [];
          const all = document.querySelectorAll('*');

          for (const el of all) {
            if (results.length >= limit) break;

            const tag = el.tagName.toUpperCase();
            if (standardTags.includes(tag)) continue;
            if (el.hasAttribute('role')) continue;
            if (el.getClientRects().length === 0) continue;

            const style = window.getComputedStyle(el);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              style.opacity === '0'
            ) continue;

            const reasons = [];
            if (style.cursor === 'pointer') reasons.push('cursor:pointer');
            if (el.hasAttribute('onclick')) reasons.push('onclick');
            const tabIndex = parseInt(el.getAttribute('tabindex') ?? '', 10);
            if (!isNaN(tabIndex) && tabIndex >= 0) reasons.push(`tabindex=${tabIndex}`);
            if (reasons.length === 0) continue;

            let text = (el.innerText || '').trim().slice(0, maxLen);
            if (!text) {
              text = el.getAttribute('aria-label') ||
                el.className.toString().trim() ||
                tag;
            }

            results.push({ selector: cssPath(el), text, reasons });
          }

          return results;
        },
        {
          limit: PSEUDO_BUTTON_LIMIT,
          maxLen: PSEUDO_BUTTON_TEXT_MAX_LENGTH,
          standardTags: STANDARD_INTERACTIVE_TAGS,
        }
      );
    } catch {
      return [];
    }
  }

  /**
   * Appends a pseudo-button section to a DOM snapshot string.
   * @param {string} domTreeString - Existing DOM snapshot
   * @param {Array} pseudoButtons - Result from extractPseudoButtons
   * @returns {string} Augmented snapshot
   */
  appendPseudoButtonsToSnapshot(domTreeString, pseudoButtons) {
    if (!pseudoButtons || pseudoButtons.length === 0) return domTreeString;

    let section = '\n── cursor-interactive (not in ARIA tree) ──\n';
    pseudoButtons.forEach((btn, i) => {
      const ref = `c${i + 1}`;
      section += `@${ref} [${btn.reasons.join(', ')}] "${btn.text}"\n`;
    });

    return domTreeString + section;
  }
}

export default DomSimplifier;
