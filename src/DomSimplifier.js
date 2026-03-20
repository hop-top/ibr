import { parse, HTMLElement, NodeType } from 'node-html-parser';
import { generateElementXPath } from './utils/xpathUtils.js';

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
          const idx = siblings.length > 1 ? `[${siblings.indexOf(node) + 1}]` : '';
          parts.unshift(`${tag}${idx}`);
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
      if (["id", "href", "src", "alt", "title", "aria-label", "role", "name", "content"].includes(key)) {
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
}

export default DomSimplifier;
