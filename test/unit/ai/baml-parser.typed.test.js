/**
 * Unit tests for typed parser wrappers:
 *   parseTaskDescriptionResponse
 *   parseFindElementsResponse
 *   parseActionInstructionResponse
 *   parseExtractionResponse
 */

import { describe, it, expect } from 'vitest';
import {
  parseTaskDescriptionResponse,
  parseFindElementsResponse,
  parseActionInstructionResponse,
  parseExtractionResponse,
} from '../../../src/ai/baml-parser.js';

// ── parseTaskDescriptionResponse ──────────────────────────────────────────────

describe('parseTaskDescriptionResponse', () => {
  it('returns parsed object when url + instructions present', () => {
    const input = JSON.stringify({
      url: 'https://example.com',
      instructions: ['click button', 'fill form'],
    });
    const result = parseTaskDescriptionResponse(input);
    expect(result.url).toBe('https://example.com');
    expect(result.instructions).toEqual(['click button', 'fill form']);
  });

  it('throws when url field is missing', () => {
    const input = JSON.stringify({ instructions: ['step1'] });
    expect(() => parseTaskDescriptionResponse(input)).toThrow('url');
  });

  it('throws when instructions field is missing', () => {
    const input = JSON.stringify({ url: 'https://example.com' });
    expect(() => parseTaskDescriptionResponse(input)).toThrow('instructions');
  });

  it('throws when instructions is not an array', () => {
    const input = JSON.stringify({
      url: 'https://example.com',
      instructions: 'click the button',
    });
    expect(() => parseTaskDescriptionResponse(input)).toThrow('instructions');
  });

  it('wraps underlying parse errors', () => {
    expect(() => parseTaskDescriptionResponse('not json at all'))
      .toThrow('Failed to parse task description');
  });

  it('accepts markdown-wrapped valid response', () => {
    const obj = { url: 'https://x.com', instructions: ['go'] };
    const input = `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
    const result = parseTaskDescriptionResponse(input);
    expect(result.url).toBe('https://x.com');
  });
});

// ── parseFindElementsResponse ─────────────────────────────────────────────────

describe('parseFindElementsResponse', () => {
  it('returns array when response is a JSON array', () => {
    const input = JSON.stringify([{ selector: 'button' }, { selector: 'a' }]);
    expect(parseFindElementsResponse(input)).toEqual([
      { selector: 'button' },
      { selector: 'a' },
    ]);
  });

  it('returns elements array when response is { elements: [...] }', () => {
    const input = JSON.stringify({ elements: [{ id: 'btn1' }, { id: 'btn2' }] });
    expect(parseFindElementsResponse(input)).toEqual([{ id: 'btn1' }, { id: 'btn2' }]);
  });

  it('returns [] for unrecognized shape (object without elements)', () => {
    const input = JSON.stringify({ foo: 'bar', count: 3 });
    expect(parseFindElementsResponse(input)).toEqual([]);
  });

  it('returns [] for unparseable input (graceful)', () => {
    expect(parseFindElementsResponse('completely unparseable garbage here')).toEqual([]);
  });

  it('returns [] when elements field exists but is not an array', () => {
    const input = JSON.stringify({ elements: 'oops' });
    expect(parseFindElementsResponse(input)).toEqual([]);
  });

  it('returns markdown list items for find_elements type', () => {
    const input = '- .btn-primary\n- #submit\n- a[href]';
    // parseFindElementsResponse calls parseWithBAML with 'find_elements'
    expect(parseFindElementsResponse(input)).toEqual(['.btn-primary', '#submit', 'a[href]']);
  });
});

// ── parseActionInstructionResponse ───────────────────────────────────────────

describe('parseActionInstructionResponse', () => {
  it('returns normalized object for valid { elements, type, value }', () => {
    const input = JSON.stringify({
      elements: ['.submit-btn'],
      type: 'click',
      value: 'submit',
    });
    const result = parseActionInstructionResponse(input);
    expect(result).toEqual({
      elements: ['.submit-btn'],
      type: 'click',
      value: 'submit',
    });
  });

  it('returns empty array for elements when missing', () => {
    const input = JSON.stringify({ type: 'click' });
    const result = parseActionInstructionResponse(input);
    expect(result.elements).toEqual([]);
  });

  it('defaults type to "click" when missing', () => {
    const input = JSON.stringify({ elements: ['#btn'] });
    const result = parseActionInstructionResponse(input);
    expect(result.type).toBe('click');
  });

  it('value is undefined when not present', () => {
    const input = JSON.stringify({ elements: ['#btn'], type: 'click' });
    const result = parseActionInstructionResponse(input);
    expect(result.value).toBeUndefined();
  });

  it('throws for completely unparseable input', () => {
    expect(() => parseActionInstructionResponse('plain English no json'))
      .toThrow('Failed to parse action instruction');
  });

  it('passes value through when provided', () => {
    const input = JSON.stringify({ elements: ['input'], type: 'fill', value: 'hello' });
    expect(parseActionInstructionResponse(input).value).toBe('hello');
  });

  // ── outcome: disambiguates an empty `elements` array ───────────────────────
  // `{"elements": []}` alone means BOTH "genuine miss" and "nothing to act on"
  // (page-level scroll, optional click). `outcome` carries which. Only the
  // literal "not_found" is a miss; anything else — including a reply with NO
  // outcome field at all (every pre-existing cassette / caller) — is not, so
  // the historical silent-skip behaviour is preserved verbatim.

  it('outcome is undefined when the field is absent (backward compatible)', () => {
    const input = JSON.stringify({ elements: [], type: 'scroll' });
    expect(parseActionInstructionResponse(input).outcome).toBeUndefined();
  });

  it('passes outcome "not_found" through', () => {
    const input = JSON.stringify({ elements: [], type: 'click', outcome: 'not_found' });
    expect(parseActionInstructionResponse(input).outcome).toBe('not_found');
  });

  it('passes outcome "no_element_needed" through', () => {
    const input = JSON.stringify({ elements: [], type: 'scroll', outcome: 'no_element_needed' });
    expect(parseActionInstructionResponse(input).outcome).toBe('no_element_needed');
  });

  it('passes outcome "found" through', () => {
    const input = JSON.stringify({ elements: ['#btn'], type: 'click', outcome: 'found' });
    expect(parseActionInstructionResponse(input).outcome).toBe('found');
  });

  it('normalizes outcome case and surrounding whitespace', () => {
    const input = JSON.stringify({ elements: [], type: 'click', outcome: '  NOT_FOUND ' });
    expect(parseActionInstructionResponse(input).outcome).toBe('not_found');
  });

  it('drops an unrecognized outcome value rather than treating it as a miss', () => {
    const input = JSON.stringify({ elements: [], type: 'click', outcome: 'maybe' });
    expect(parseActionInstructionResponse(input).outcome).toBeUndefined();
  });

  it('drops a non-string outcome value', () => {
    const input = JSON.stringify({ elements: [], type: 'click', outcome: 3 });
    expect(parseActionInstructionResponse(input).outcome).toBeUndefined();
  });
});

// ── parseExtractionResponse ───────────────────────────────────────────────────

describe('parseExtractionResponse', () => {
  it('returns array as-is when response is a JSON array', () => {
    const input = JSON.stringify([{ name: 'Alice' }, { name: 'Bob' }]);
    expect(parseExtractionResponse(input)).toEqual([{ name: 'Alice' }, { name: 'Bob' }]);
  });

  it('returns data array when response is { data: [...] }', () => {
    const input = JSON.stringify({ data: [1, 2, 3] });
    expect(parseExtractionResponse(input)).toEqual([1, 2, 3]);
  });

  it('wraps an unrecognized object shape as a one-element record', () => {
    // A payload the model wrapped under its own key is still extracted data;
    // preserve it as [obj] rather than dropping it.
    const input = JSON.stringify({ results: ['x', 'y'] });
    expect(parseExtractionResponse(input)).toEqual([{ results: ['x', 'y'] }]);
  });

  it('returns [] for unparseable input (graceful)', () => {
    expect(parseExtractionResponse('no json here at all anywhere')).toEqual([]);
  });

  it('wraps object with non-array data field rather than dropping it', () => {
    const input = JSON.stringify({ data: 'oops' });
    expect(parseExtractionResponse(input)).toEqual([{ data: 'oops' }]);
  });

  it('returns markdown list items via extraction type', () => {
    const input = '- row1\n- row2\n- row3';
    expect(parseExtractionResponse(input)).toEqual(['row1', 'row2', 'row3']);
  });
});
