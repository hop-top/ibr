import { describe, it, expect } from 'vitest';
import { generateElementXPath } from '../../../src/utils/xpathUtils.js';

function makeElement(tagName, siblings = []) {
  const element = { tagName };
  const parentNode = {
    children: siblings.length > 0 ? siblings : [element],
  };
  element.parentNode = parentNode;
  return element;
}

describe('generateElementXPath', () => {
  describe('single child of tag', () => {
    it('returns path without index suffix when only one sibling with same tag', () => {
      const el = makeElement('DIV');
      const result = generateElementXPath('/html/body', el);
      expect(result).toBe('/html/body/DIV');
    });

    it('returns path without index when parent has mixed tags', () => {
      const span = makeElement('SPAN');
      const div = makeElement('DIV');
      span.parentNode = { children: [span, div] };
      div.parentNode = span.parentNode;
      const result = generateElementXPath('/html/body', span);
      expect(result).toBe('/html/body/SPAN');
    });
  });

  describe('multiple siblings with same tag', () => {
    it('first sibling gets [1] suffix', () => {
      const el1 = makeElement('LI');
      const el2 = makeElement('LI');
      const parent = { children: [el1, el2] };
      el1.parentNode = parent;
      el2.parentNode = parent;
      expect(generateElementXPath('/ul', el1)).toBe('/ul/LI[1]');
    });

    it('second sibling gets [2] suffix', () => {
      const el1 = makeElement('LI');
      const el2 = makeElement('LI');
      const parent = { children: [el1, el2] };
      el1.parentNode = parent;
      el2.parentNode = parent;
      expect(generateElementXPath('/ul', el2)).toBe('/ul/LI[2]');
    });

    it('third of three siblings gets [3]', () => {
      const els = [makeElement('TR'), makeElement('TR'), makeElement('TR')];
      const parent = { children: els };
      els.forEach(e => { e.parentNode = parent; });
      expect(generateElementXPath('/table/tbody', els[2])).toBe('/table/tbody/TR[3]');
    });
  });

  describe('empty parentXPath', () => {
    it('path starts directly at element tag when parentXPath is empty string', () => {
      const el = makeElement('HTML');
      const result = generateElementXPath('', el);
      expect(result).toBe('/HTML');
    });
  });

  describe('nested path composition', () => {
    it('appends tag to complex parent path', () => {
      const el = makeElement('A');
      const result = generateElementXPath('/html/body/div/p', el);
      expect(result).toBe('/html/body/div/p/A');
    });
  });
});
