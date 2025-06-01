import { parse, HTMLElement, NodeType } from 'node-html-parser';
import { generateElementXPath } from './utils/xpathUtils.js';

export class DomSimplifier {
  constructor(page) {
    this.page = page;
    this.xpaths = [];
  }

  async simplify() {
    const html = await this.page.content();
    const root = parse(html);
    this.xpaths = [];
    return this.#simplifyDomTree(root.children[0]);
  }

  /**
   * Simplifies the DOM tree by removing non-essential elements and attributes
   * @param {HTMLElement} element - The element to simplify
   * @param {string} parentXPath - The XPath of the parent element (default: empty string)
   * @returns {Object} The simplified DOM tree
   */
  #simplifyDomTree(element, parentXPath = "") {
    const filteredChildren = element.children.filter((child) => {
      return !["SCRIPT", "STYLE", "BROWSER-FONT-SIZE", "SVG", "LINK", "NOSCRIPT"].includes(child.tagName);
    });

    const filteredAttributes = Object.keys(element.attributes).reduce((acc, key) => {
      if (["id", "href", "src", "alt", "title", "aria-label", "name", "content"].includes(key)) {
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

    const simplifiedElement = {
      x: xPathIdx,
      n: element.tagName,
      t: text,
      a: filteredAttributes,
      c: filteredChildren.map((child) => {
        if (child instanceof HTMLElement) {
          return this.#simplifyDomTree(child, xPath);
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
