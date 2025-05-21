import { chromium } from 'playwright';
import { parse, HTMLElement, NodeType } from 'node-html-parser';

const DELAY = 2500;
const SCROLL_DELAY = DELAY * 0.2;
const SCROLL_COUNT = 5;

function simplifyDomTree(element) {
  const filteredChildren = element.children.filter((child) => {
    if (["SCRIPT", "STYLE", "BROWSER-FONT-SIZE", "SVG", "LINK", "NOSCRIPT"].includes(child.tagName)) {
      return false;
    }
    return true;
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

  const simplifiedElement = {
    n: element.tagName,
    t: text,
    a: filteredAttributes,
    c: filteredChildren.map((child) => {
      if (child instanceof HTMLElement) {
        return simplifyDomTree(child);
      }
      return child;
    }),
  };

  return simplifiedElement;
}

function stringFromSimplifiedDomTree(simplifiedDomTree) {
  return JSON.stringify(simplifiedDomTree)
    .replaceAll(/,+"t":""/g, "")
    .replaceAll(/,+"c":\[\]/g, "")
    .replaceAll(/,+"a":\{\}/g, "");
}

async function run() {
  // Launch the browser
  const browser = await chromium.launch({
    headless: false, // Set to true for production
    slowMo: 100, // Slow down by 100ms for demo purposes
  });

  try {
    // Create a new browser context and page
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://www.airbnb.com/users/show/102012735');
    await new Promise((resolve) => setTimeout(resolve, DELAY));

    const html = await page.content();
    const root = parse(html);
    const simplifiedDomTree = simplifyDomTree(root);
    console.log(stringFromSimplifiedDomTree(simplifiedDomTree));
    // Extract some data

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    // Close the browser
    await browser.close();
  }
}

run();
