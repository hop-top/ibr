/**
 * Unit tests for parseWithBAML (strategy-level parsing)
 */

import { describe, it, expect } from 'vitest';
import { parseWithBAML } from '../../../src/ai/baml-parser.js';

describe('parseWithBAML', () => {
  // ── Strategy 1: plain JSON ──────────────────────────────────────────────

  describe('Strategy 1 – plain JSON object', () => {
    it('parses a plain JSON object string', () => {
      const input = '{"url":"https://example.com","instructions":["step1"]}';
      const result = parseWithBAML(input);
      expect(result).toEqual({ url: 'https://example.com', instructions: ['step1'] });
    });

    it('parses a plain JSON array string', () => {
      const input = '[{"id":1},{"id":2}]';
      const result = parseWithBAML(input);
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('parses JSON with surrounding whitespace', () => {
      const input = '  { "key": "value" }  ';
      expect(parseWithBAML(input)).toEqual({ key: 'value' });
    });
  });

  // ── Strategy 2: markdown-wrapped JSON ──────────────────────────────────

  describe('Strategy 2 – markdown-wrapped JSON', () => {
    it('parses ```json ... ``` wrapped object', () => {
      const input = '```json\n{"foo":"bar"}\n```';
      expect(parseWithBAML(input)).toEqual({ foo: 'bar' });
    });

    it('parses ``` (no language tag) ... ``` wrapped object', () => {
      const input = '```\n{"foo":"baz"}\n```';
      expect(parseWithBAML(input)).toEqual({ foo: 'baz' });
    });

    it('parses ```json wrapped array', () => {
      const input = '```json\n[1,2,3]\n```';
      expect(parseWithBAML(input)).toEqual([1, 2, 3]);
    });
  });

  // ── Strategy 3: JSON embedded in prose text ─────────────────────────────

  describe('Strategy 3 – JSON embedded in prose', () => {
    it('extracts object from surrounding prose', () => {
      const input = 'Here is the result: {"status":"ok"} — done.';
      expect(parseWithBAML(input)).toEqual({ status: 'ok' });
    });

    it('extracts array from surrounding prose', () => {
      const input = 'The elements are [{"tag":"a"},{"tag":"button"}] in the page.';
      expect(parseWithBAML(input)).toEqual([{ tag: 'a' }, { tag: 'button' }]);
    });
  });

  // ── Strategy 4: code block with language specifier prefix ───────────────

  describe('Strategy 4 – code block with language specifier', () => {
    it('strips language prefix and parses JSON', () => {
      // Strategy 2 regex requires the outer ticks; strategy 4 strips "json\n" prefix
      // Craft input that is NOT plain JSON and NOT already handled by strat-2/3
      // A code block with a language prefix where inner content starts with "json\n"
      const inner = 'json\n{"action":"click"}';
      const input = `\`\`\`${inner}\`\`\``;
      expect(parseWithBAML(input)).toEqual({ action: 'click' });
    });
  });

  // ── Strategy 5: JSONL ───────────────────────────────────────────────────

  describe('Strategy 5 – JSONL', () => {
    it('parses multiple JSON objects on separate lines', () => {
      const input = '{"a":1}\n{"b":2}\n{"c":3}';
      const result = parseWithBAML(input);
      expect(result).toEqual({ data: [{ a: 1 }, { b: 2 }, { c: 3 }] });
    });

    it('returns unwrapped object when JSONL has single line', () => {
      // single JSON line that isn't valid plain JSON on its own passes strat-1 first;
      // test a case where strat-1 succeeds — single-line JSONL reduces to plain JSON
      const input = '{"x":42}';
      expect(parseWithBAML(input)).toEqual({ x: 42 });
    });
  });

  // ── Strategy 6: markdown list ───────────────────────────────────────────

  describe('Strategy 6 – markdown list (extraction / find_elements only)', () => {
    it('parses dash-prefixed list for extraction type', () => {
      const input = '- item one\n- item two\n- item three';
      const result = parseWithBAML(input, 'extraction');
      expect(result).toEqual(['item one', 'item two', 'item three']);
    });

    it('parses numbered list for find_elements type', () => {
      const input = '1. first\n2. second\n3. third';
      const result = parseWithBAML(input, 'find_elements');
      expect(result).toEqual(['first', 'second', 'third']);
    });

    it('parses asterisk-prefixed list for extraction type', () => {
      const input = '* alpha\n* beta';
      const result = parseWithBAML(input, 'extraction');
      expect(result).toEqual(['alpha', 'beta']);
    });

    it('does NOT parse markdown list for generic type → throws', () => {
      const input = '- item one\n- item two';
      expect(() => parseWithBAML(input, 'generic')).toThrow('BAML parser');
    });
  });

  // ── All strategies fail ─────────────────────────────────────────────────

  describe('all strategies fail', () => {
    it('throws when nothing is parseable', () => {
      const input = 'this is just plain English text with no JSON at all';
      expect(() => parseWithBAML(input)).toThrow('BAML parser: Unable to extract JSON');
    });

    it('includes a preview of the input in the error message', () => {
      const input = 'completely unparseable response here';
      let msg = '';
      try {
        parseWithBAML(input);
      } catch (e) {
        msg = e.message;
      }
      expect(msg).toContain('completely unparseable');
    });

    it('truncates long inputs with ellipsis in error message', () => {
      const input = 'x'.repeat(300);
      let msg = '';
      try {
        parseWithBAML(input);
      } catch (e) {
        msg = e.message;
      }
      expect(msg).toContain('...');
    });
  });

  // ── Guard clauses ───────────────────────────────────────────────────────

  describe('guard clauses', () => {
    it('throws immediately for null input', () => {
      expect(() => parseWithBAML(null)).toThrow('Invalid response format');
    });

    it('throws immediately for undefined input', () => {
      expect(() => parseWithBAML(undefined)).toThrow('Invalid response format');
    });

    it('throws immediately for number input', () => {
      expect(() => parseWithBAML(42)).toThrow('Invalid response format');
    });

    it('throws immediately for object input', () => {
      expect(() => parseWithBAML({ key: 'val' })).toThrow('Invalid response format');
    });

    it('throws for empty string', () => {
      expect(() => parseWithBAML('')).toThrow();
    });

    it('throws for whitespace-only string', () => {
      expect(() => parseWithBAML('   ')).toThrow();
    });
  });
});
