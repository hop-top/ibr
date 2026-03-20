/**
 * Unit tests for DomSimplifier
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { DomSimplifier } from '../../src/DomSimplifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return readFileSync(path.join(fixturesDir, name), 'utf-8');
}

function makePage(html) {
  return { content: vi.fn().mockResolvedValue(html) };
}

/**
 * Build a mock page that simulates a selector-scoped call.
 * page.evaluate() is called by DomSimplifier.simplify() when selector is set;
 * it returns { html, xpath } for the scoped root.
 *
 * @param {string} scopedHtml   - outerHTML of the scoped element
 * @param {string} absoluteXPath - absolute XPath of the scoped element
 */
function makeScopedPage(scopedHtml, absoluteXPath) {
  return {
    content: vi.fn(),  // not called when selector present
    evaluate: vi.fn().mockResolvedValue({ html: scopedHtml, xpath: absoluteXPath }),
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function collectTagNames(node, acc = []) {
  if (node && node.n) acc.push(node.n);
  if (node && Array.isArray(node.c)) node.c.forEach(c => collectTagNames(c, acc));
  return acc;
}

function findNode(node, tagName) {
  if (node && node.n === tagName) return node;
  if (node && Array.isArray(node.c)) {
    for (const c of node.c) {
      const found = findNode(c, tagName);
      if (found) return found;
    }
  }
  return null;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DomSimplifier', () => {
  describe('simplify()', () => {
    it('strips SCRIPT elements', async () => {
      const html = `<html><head></head><body><script>alert(1)</script><p>Hi</p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const tags = collectTagNames(result);
      expect(tags).not.toContain('SCRIPT');
    });

    it('strips STYLE elements', async () => {
      const html = `<html><head><style>body{}</style></head><body><p>Hi</p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const tags = collectTagNames(result);
      expect(tags).not.toContain('STYLE');
    });

    it('strips SVG elements', async () => {
      const html = `<html><head></head><body>
        <svg viewBox="0 0 10 10"><circle/></svg><p>ok</p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const tags = collectTagNames(result);
      expect(tags).not.toContain('SVG');
    });

    it('strips LINK elements', async () => {
      const html = `<html><head><link rel="stylesheet" href="/a.css"></head>
        <body><p>ok</p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const tags = collectTagNames(result);
      expect(tags).not.toContain('LINK');
    });

    it('strips NOSCRIPT elements', async () => {
      const html = `<html><head></head><body>
        <noscript>enable js</noscript><p>ok</p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const tags = collectTagNames(result);
      expect(tags).not.toContain('NOSCRIPT');
    });

    it('keeps only allowed attributes (id, href, src, alt, title, aria-label, name, content)',
      async () => {
        const html = `<html><head></head><body>
          <a id="lnk" href="/go" class="btn" data-x="y" title="go link">click</a>
          </body></html>`;
        const ds = new DomSimplifier(makePage(html));
        const result = await ds.simplify();
        const a = findNode(result, 'A');
        expect(a).toBeTruthy();
        expect(a.a).toMatchObject({ id: 'lnk', href: '/go', title: 'go link' });
        expect(a.a).not.toHaveProperty('class');
        expect(a.a).not.toHaveProperty('data-x');
      });

    it('keeps aria-label attribute', async () => {
      const html = `<html><head></head>
        <body><button aria-label="Close dialog" onclick="x()">X</button></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const btn = findNode(result, 'BUTTON');
      expect(btn.a).toMatchObject({ 'aria-label': 'Close dialog' });
      expect(btn.a).not.toHaveProperty('onclick');
    });

    it('keeps data-idx-ref and role attributes; strips non-allowed attrs', async () => {
      const html = `<html><head></head>
        <body><div role="navigation" data-idx-ref="c1" class="nav" data-v="1">nav</div></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const div = findNode(result, 'DIV');
      expect(div.a).toHaveProperty('data-idx-ref', 'c1');
      expect(div.a).toHaveProperty('role', 'navigation');
      expect(div.a).not.toHaveProperty('class');
      expect(div.a).not.toHaveProperty('data-v');
    });

    it('keeps name and content attributes', async () => {
      const html = `<html><head>
        <meta name="description" content="Page desc" charset="UTF-8">
        </head><body></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const meta = findNode(result, 'META');
      expect(meta.a).toMatchObject({ name: 'description', content: 'Page desc' });
      expect(meta.a).not.toHaveProperty('charset');
    });

    it('assigns consecutive XPath indices to siblings with the same tag', async () => {
      const html = `<html><head></head><body>
        <p>First</p><p>Second</p><p>Third</p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      // xpaths array is populated; multiple P siblings get indexed XPaths
      const xpathsWithP = ds.xpaths.filter(x => x.includes('P['));
      expect(xpathsWithP.length).toBeGreaterThanOrEqual(3);
      // indices must be sequential: P[1], P[2], P[3]
      const indices = xpathsWithP.map(x => {
        const m = x.match(/P\[(\d+)\]/);
        return m ? parseInt(m[1]) : null;
      }).filter(Boolean).sort();
      expect(indices).toEqual([1, 2, 3]);
    });

    it('does NOT add index when only one child has a given tag', async () => {
      const html = `<html><head></head><body><h1>Title</h1></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      await ds.simplify();
      const h1Xpaths = ds.xpaths.filter(x => x.includes('H1'));
      expect(h1Xpaths.every(x => !x.includes('['))).toBe(true);
    });

    it('extracts text content from direct TEXT_NODEs', async () => {
      const html = `<html><head></head><body>
        <p>Hello <strong>world</strong></p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const p = findNode(result, 'P');
      // only direct text nodes — "Hello " (the strong is a child element)
      expect(p.t).toContain('Hello');
    });

    it('leaves t empty when element has no direct text nodes', async () => {
      const html = `<html><head></head><body><div><span>inner</span></div></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const result = await ds.simplify();
      const div = findNode(result, 'DIV');
      expect(div.t).toBe('');
    });

    it('processes simple-page.html fixture without throwing', async () => {
      const html = loadFixture('simple-page.html');
      const ds = new DomSimplifier(makePage(html));
      await expect(ds.simplify()).resolves.toBeDefined();
    });

    it('processes product-list.html fixture without throwing', async () => {
      const html = loadFixture('product-list.html');
      const ds = new DomSimplifier(makePage(html));
      await expect(ds.simplify()).resolves.toBeDefined();
    });
  });

  // ── stringifySimplifiedDom ──────────────────────────────────────────────────

  describe('stringifySimplifiedDom()', () => {
    it('returns valid JSON string', async () => {
      const html = `<html><head></head><body><p>Hi</p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const tree = await ds.simplify();
      const str = ds.stringifySimplifiedDom(tree);
      expect(() => JSON.parse(str)).not.toThrow();
    });

    it('removes empty "t" keys from output', async () => {
      const html = `<html><head></head><body><div><p>text</p></div></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const tree = await ds.simplify();
      const str = ds.stringifySimplifiedDom(tree);
      // should not contain ,"t":"" anywhere
      expect(str).not.toMatch(/,"t":""/);
    });

    it('removes empty "c" arrays from output', async () => {
      const html = `<html><head></head><body><br></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const tree = await ds.simplify();
      const str = ds.stringifySimplifiedDom(tree);
      expect(str).not.toMatch(/,"c":\[\]/);
    });

    it('removes empty "a" objects from output', async () => {
      const html = `<html><head></head><body><p>hi</p></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const tree = await ds.simplify();
      const str = ds.stringifySimplifiedDom(tree);
      expect(str).not.toMatch(/,"a":\{\}/);
    });

    it('preserves non-empty a/t/c keys in output', async () => {
      const html = `<html><head></head>
        <body><a id="nav" href="/home">Home</a></body></html>`;
      const ds = new DomSimplifier(makePage(html));
      const tree = await ds.simplify();
      const str = ds.stringifySimplifiedDom(tree);
      const parsed = JSON.parse(str);
      const a = findNode(parsed, 'A');
      expect(a.a).toMatchObject({ id: 'nav', href: '/home' });
      expect(a.t).toBe('Home');
    });
  });

  // ── appendPseudoButtonsToSnapshot ──────────────────────────────────────────

  describe('appendPseudoButtonsToSnapshot()', () => {
    it('returns original string unchanged when pseudoButtons is empty', () => {
      const ds = new DomSimplifier(makePage('<html></html>'));
      const base = '{"x":0,"n":"HTML"}';
      expect(ds.appendPseudoButtonsToSnapshot(base, [])).toBe(base);
      expect(ds.appendPseudoButtonsToSnapshot(base, null)).toBe(base);
    });

    it('appends cursor-interactive section with @cN refs', () => {
      const ds = new DomSimplifier(makePage('<html></html>'));
      const base = '{"x":0}';
      const buttons = [
        { reasons: ['cursor:pointer'], text: 'Open menu', selector: 'div:nth-child(1)' },
        { reasons: ['onclick', 'tabindex=0'], text: 'Submit', selector: 'span:nth-child(2)' },
      ];
      const result = ds.appendPseudoButtonsToSnapshot(base, buttons);
      expect(result).toContain('@c1');
      expect(result).toContain('@c2');
      expect(result).toContain('cursor:pointer');
      expect(result).toContain('onclick');
      expect(result).toContain('Open menu');
      expect(result).toContain('Submit');
      expect(result.startsWith(base)).toBe(true);
    });

    it('assigns sequential c refs starting at 1', () => {
      const ds = new DomSimplifier(makePage('<html></html>'));
      const buttons = Array.from({ length: 3 }, (_, i) => ({
        reasons: ['cursor:pointer'], text: `btn${i}`, selector: `div:nth-child(${i + 1})`,
      }));
      const result = ds.appendPseudoButtonsToSnapshot('{}', buttons);
      expect(result).toContain('@c1');
      expect(result).toContain('@c2');
      expect(result).toContain('@c3');
      expect(result).not.toContain('@c0');
    });
  });

  // ── extractPseudoButtons ────────────────────────────────────────────────────

  describe('extractPseudoButtons()', () => {
    it('returns empty array when page.evaluate throws', async () => {
      const ds = new DomSimplifier(makePage('<html></html>'));
      const badPage = { evaluate: vi.fn().mockRejectedValue(new Error('eval error')) };
      const result = await ds.extractPseudoButtons(badPage);
      expect(result).toEqual([]);
    });

    it('returns the value from page.evaluate on success', async () => {
      const ds = new DomSimplifier(makePage('<html></html>'));
      const fakeButtons = [{ selector: 'div:nth-child(1)', text: 'Click me', reasons: ['cursor:pointer'] }];
      const mockPage = { evaluate: vi.fn().mockResolvedValue(fakeButtons) };
      const result = await ds.extractPseudoButtons(mockPage);
      expect(result).toEqual(fakeButtons);
    });
  });

  // ── selector-scoped (-s) XPath absolute paths ──────────────────────────────

  describe('simplify() with selector (-s) — XPaths are document-absolute', () => {
    it('XPaths start with the absolute prefix of the scoped root, not "/"', async () => {
      // Scoped root lives at /HTML/BODY/NAV in the live document.
      // DomSimplifier strips the root tag from the live xpath to get parentXPath
      // (/HTML/BODY), then generateElementXPath appends /NAV.
      // Result must start with /HTML/BODY/NAV, not just /NAV.
      const scopedHtml = `<nav><a href="/home">Home</a></nav>`;
      const absoluteXPath = '/HTML/BODY/NAV';
      const page = makeScopedPage(scopedHtml, absoluteXPath);

      const ds = new DomSimplifier(page, { selector: 'nav' });
      await ds.simplify();

      // Every generated XPath must begin with the document-absolute prefix
      expect(ds.xpaths.length).toBeGreaterThan(0);
      for (const xp of ds.xpaths) {
        expect(xp).toMatch(/^\/HTML\/BODY\//);
      }
    });

    it('XPaths are usable with document.evaluate (start with /HTML)', async () => {
      const scopedHtml = `<section id="main"><p>text</p></section>`;
      const absoluteXPath = '/HTML/BODY/MAIN/SECTION';
      const page = makeScopedPage(scopedHtml, absoluteXPath);

      const ds = new DomSimplifier(page, { selector: '#main' });
      await ds.simplify();

      // Must begin with /HTML (document-absolute, not relative)
      for (const xp of ds.xpaths) {
        expect(xp.startsWith('/HTML')).toBe(true);
      }
    });

    it('regression: without the fix XPaths would start with empty prefix (/NAV instead of /HTML/BODY/NAV)', async () => {
      // Simulate the broken state: if parentXPath were '' (no absolute prefix),
      // the root node XPath would be just '/NAV'.
      // With the fix applied, it must be '/HTML/BODY/NAV'.
      const scopedHtml = `<nav role="navigation"><ul><li>item</li></ul></nav>`;
      const absoluteXPath = '/HTML/BODY/NAV';
      const page = makeScopedPage(scopedHtml, absoluteXPath);

      const ds = new DomSimplifier(page, { selector: 'nav' });
      await ds.simplify();

      const navXpath = ds.xpaths.find(x => x.endsWith('/NAV'));
      expect(navXpath).toBeDefined();
      // Must NOT be bare '/NAV' — must have document-absolute parent prefix
      expect(navXpath).not.toBe('/NAV');
      expect(navXpath).toContain('/HTML/BODY/NAV');
    });
  });
});
