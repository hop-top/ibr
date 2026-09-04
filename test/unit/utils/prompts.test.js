import { describe, it, expect } from 'vitest';
import {
  makeTaskDescriptionMessage,
  makeFindInstructionMessage,
  makeFindInstructionWithDiffMessage,
  makeActionInstructionMessage,
  makeExtractInstructionMessage,
  makeVisualFindMessage,
  makeVisualExtractMessage,
} from '../../../src/utils/prompts.js';
import { parseFindElementsResponse, parseExtractionResponse } from '../../../src/ai/baml-parser.js';

describe('makeTaskDescriptionMessage', () => {
  const msg = makeTaskDescriptionMessage('Go to https://example.com and click login');

  it('returns array of length 2', () => {
    expect(msg).toHaveLength(2);
  });

  it('[0].role is system', () => {
    expect(msg[0].role).toBe('system');
  });

  it('[1].role is user', () => {
    expect(msg[1].role).toBe('user');
  });

  it('user message contains supplied userPrompt', () => {
    expect(msg[1].content).toContain('Go to https://example.com and click login');
  });

  it('system prompt mentions JSON', () => {
    expect(msg[0].content).toContain('JSON');
  });

  it('system prompt mentions array (instructions)', () => {
    expect(msg[0].content.toLowerCase()).toContain('array');
  });

  it('system prompt mentions url', () => {
    expect(msg[0].content.toLowerCase()).toContain('url');
  });
});

describe('makeFindInstructionMessage', () => {
  const domTree = '{"n":"body","c":[{"n":"a","t":"Login"}]}';
  const msg = makeFindInstructionMessage('find the login link', domTree);

  it('returns array of length 2', () => {
    expect(msg).toHaveLength(2);
  });

  it('[0].role is system', () => {
    expect(msg[0].role).toBe('system');
  });

  it('[1].role is user', () => {
    expect(msg[1].role).toBe('user');
  });

  it('user message contains supplied userPrompt', () => {
    expect(msg[1].content).toContain('find the login link');
  });

  it('user message embeds domTree', () => {
    expect(msg[1].content).toContain(domTree);
  });

  it('system prompt mentions JSON array', () => {
    expect(msg[0].content).toContain('JSON array');
  });
});

describe('makeActionInstructionMessage', () => {
  const domTree = '{"n":"button","t":"Submit"}';
  const msg = makeActionInstructionMessage('click the submit button', domTree);

  it('returns array of length 2', () => {
    expect(msg).toHaveLength(2);
  });

  it('[0].role is system', () => {
    expect(msg[0].role).toBe('system');
  });

  it('[1].role is user', () => {
    expect(msg[1].role).toBe('user');
  });

  it('user message contains supplied userPrompt', () => {
    expect(msg[1].content).toContain('click the submit button');
  });

  it('user message embeds domTree', () => {
    expect(msg[1].content).toContain(domTree);
  });

  it('system prompt mentions JSON object', () => {
    expect(msg[0].content).toContain('JSON object');
  });
});

describe('makeExtractInstructionMessage', () => {
  const domTree = '{"n":"table","c":[{"n":"tr","t":"row1"}]}';
  const msg = makeExtractInstructionMessage('extract all table rows', domTree);

  it('returns array of length 2', () => {
    expect(msg).toHaveLength(2);
  });

  it('[0].role is system', () => {
    expect(msg[0].role).toBe('system');
  });

  it('[1].role is user', () => {
    expect(msg[1].role).toBe('user');
  });

  it('user message contains supplied userPrompt', () => {
    expect(msg[1].content).toContain('extract all table rows');
  });

  it('user message embeds domTree', () => {
    expect(msg[1].content).toContain(domTree);
  });

  it('system prompt mentions JSON array', () => {
    expect(msg[0].content).toContain('JSON array');
  });
});

// ── visual (Set-of-Marks) find/extract prompts ─────────────────────────────────
// Unit 2 (vision-mode): the model reads a marked screenshot instead of an
// ARIA/DOM snapshot, but MUST reply in the SAME JSON shapes the text find/
// extract paths already emit, so baml-parser.js + verdict handling need ZERO
// changes downstream. Find: an array of descriptor objects (mirroring
// [{"role":...}] / [{"x":...}]) whose descriptor is {"mark": N} instead of a
// role/name or x ref. Extract: identical framing to the text extract prompt
// (JSON array, verdict guidance reused verbatim).
//
// Contract fix (post-d9fa6df): AnnotationService draws the ref-label STRING
// on the overlay pixels (elements: "@e0"/"@c1"; grid cells: "r0c0"), and
// VisualRepresenter.markMap is keyed by exactly those strings — not by a
// synthetic sequential index. The model can only report what it visually
// reads off the image, so it must echo the label string verbatim; asking for
// "the integer 1..N" has no correspondence to what's drawn and every
// markMap.get(reply) would miss. makeVisualFindMessage therefore takes the
// actual list of drawn labels (markLabels), not a count, and instructs the
// model to pick one of THOSE strings.

describe('makeVisualFindMessage', () => {
  const labels = ['@e0', '@e1', '@c1'];
  const msg = makeVisualFindMessage('find the login button', labels);

  it('returns array of length 2', () => {
    expect(msg).toHaveLength(2);
  });

  it('[0].role is system', () => {
    expect(msg[0].role).toBe('system');
  });

  it('[1].role is user', () => {
    expect(msg[1].role).toBe('user');
  });

  it('user message contains supplied userPrompt', () => {
    expect(msg[1].content).toContain('find the login button');
  });

  it('system prompt mentions the mark label JSON shape with a string example', () => {
    expect(msg[0].content).toContain('"mark"');
    expect(msg[0].content).toContain('[{"mark":"@e2"}]');
  });

  it('system prompt lists the actual drawn labels, not a count', () => {
    for (const label of labels) {
      expect(msg[0].content).toContain(label);
    }
  });

  it('user message also lists the available labels', () => {
    for (const label of labels) {
      expect(msg[1].content).toContain(label);
    }
  });

  it('system prompt instructs verbatim reproduction (never invent or renumber)', () => {
    expect(msg[0].content.toLowerCase()).toContain('verbatim');
    expect(msg[0].content.toLowerCase()).toMatch(/never invent|do not invent/);
  });

  it('system prompt mentions JSON array (matches existing find shape)', () => {
    expect(msg[0].content).toContain('JSON array');
  });

  it('reply parses via parseFindElementsResponse into the existing find shape (array of descriptors)', () => {
    const modelReply = '[{"mark": "@e1"}]';
    const parsed = parseFindElementsResponse(modelReply);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].mark).toBe('@e1');
  });

  it('a returned label string resolves via markMap.get() the way Operations (task 4) will use it', () => {
    const markMap = new Map([
      ['@e0', { bbox: { x: 0, y: 0, w: 10, h: 10 } }],
      ['@e1', { bbox: { x: 20, y: 20, w: 10, h: 10 } }],
      ['@c1', { bbox: { x: 40, y: 40, w: 10, h: 10 } }],
    ]);
    const modelReply = '[{"mark": "@e1"}]';
    const parsed = parseFindElementsResponse(modelReply);
    const resolved = markMap.get(parsed[0].mark);
    expect(resolved).toBeDefined();
    expect(resolved.bbox).toEqual({ x: 20, y: 20, w: 10, h: 10 });
  });

  it('grid-cell label style ("r0c0") also round-trips through the parser', () => {
    const gridMsg = makeVisualFindMessage('find the search box', ['r0c0', 'r0c1', 'r1c0']);
    expect(gridMsg[0].content).toContain('r0c0');
    const parsed = parseFindElementsResponse('[{"mark": "r1c0"}]');
    expect(parsed[0].mark).toBe('r1c0');
  });

  it('empty-match reply ([]) parses to an empty array, same as text find', () => {
    expect(parseFindElementsResponse('[]')).toEqual([]);
  });

  // The mark alone cannot drive fill/type/press: those need the value the
  // user asked for, which lives only in the free-form instruction prose. The
  // visual find prompt therefore asks for an OPTIONAL "value" alongside the
  // mark, mirroring makeActionInstructionMessage's {elements,type,value}.
  it('system prompt asks for an optional value alongside the mark', () => {
    expect(msg[0].content).toContain('"value"');
    expect(msg[0].content).toContain('[{"mark":"@e2","value":"user@example.com"}]');
  });

  it('system prompt keeps the value optional (click replies omit it)', () => {
    expect(msg[0].content.toLowerCase()).toMatch(/omit .*value|value.*omit/);
  });

  it('system prompt still forbids raw pixel coordinates', () => {
    expect(msg[0].content.toLowerCase()).toContain('never return raw pixel coordinates');
  });

  it('a mark+value reply parses via parseFindElementsResponse with both fields', () => {
    const parsed = parseFindElementsResponse('[{"mark": "@e1", "value": "user@example.com"}]');
    expect(parsed[0].mark).toBe('@e1');
    expect(parsed[0].value).toBe('user@example.com');
  });

  it('a value-less (click) reply still parses, value undefined', () => {
    const parsed = parseFindElementsResponse('[{"mark": "@e1"}]');
    expect(parsed[0].mark).toBe('@e1');
    expect(parsed[0].value).toBeUndefined();
  });
});

describe('makeVisualExtractMessage', () => {
  const msg = makeVisualExtractMessage('extract the total price');

  it('returns array of length 2', () => {
    expect(msg).toHaveLength(2);
  });

  it('[0].role is system', () => {
    expect(msg[0].role).toBe('system');
  });

  it('[1].role is user', () => {
    expect(msg[1].role).toBe('user');
  });

  it('user message contains supplied userPrompt', () => {
    expect(msg[1].content).toContain('extract the total price');
  });

  it('system prompt mentions JSON array (matches existing extract shape)', () => {
    expect(msg[0].content).toContain('JSON array');
  });

  it('system prompt says if nothing found, return empty array (same contract as text extract)', () => {
    expect(msg[0].content).toContain('If nothing found, return empty array: []');
  });

  it('reply parses via parseExtractionResponse into the existing extract shape (array)', () => {
    const modelReply = '["$42.00"]';
    const parsed = parseExtractionResponse(modelReply);
    expect(parsed).toEqual(['$42.00']);
  });

  it('a verdict-style reply parses like text extract (single-object array)', () => {
    const modelReply = '{"verdict":"PAGE_OK"}';
    const parsed = parseExtractionResponse(modelReply);
    expect(parsed).toEqual([{ verdict: 'PAGE_OK' }]);
  });

  it('empty reply ([]) parses to an empty array, same as text extract', () => {
    expect(parseExtractionResponse('[]')).toEqual([]);
  });
});

// ── wait vs wait_for_human classification guidance ────────────────────────────
// Bug: 'wait for the page to load' was classified as wait_for_human, whose
// handler blocks reading stdin. Under headless/no-TTY CLI usage stdin never
// arrives → indefinite silent block with zero output. The task-parse prompt
// listed both wait formats but gave the model no rule for choosing between
// them, and "wait for <X>" phrasing pattern-matched the human-wait format.
//
// Fix (prompt half): the task-description system prompt must state that
// waiting for the page / an element / content / a condition to load or appear
// is a "wait" instruction, and that "wait_for_human" is reserved for explicit
// human-in-the-loop phrasing ("wait for me…", "ask me…", "pause for user
// input", "let me…"). General rules — not over-fit to 'page to load'.

describe('makeTaskDescriptionMessage — wait vs wait_for_human classification', () => {
  const sys = makeTaskDescriptionMessage(
    'go to https://example.com, wait for the login form to load, then click submit'
  )[0].content;

  it('still defines both wait instruction formats', () => {
    expect(sys).toContain('"wait_for_human"');
    expect(sys).toContain('"wait"');
  });

  it('guides page/element/condition load-or-appear waits to "wait", with "wait for the page to load" as an example', () => {
    expect(sys.toLowerCase()).toContain('wait for the page to load');
    expect(sys).toMatch(/load,? appear/i);
  });

  it('restricts wait_for_human to explicit human intervention phrasing', () => {
    expect(sys).toMatch(/ONLY when the instruction explicitly asks a human/i);
  });

  it('states that waiting for the page or its content is NEVER wait_for_human', () => {
    expect(sys).toMatch(/NEVER\s+"wait_for_human"/);
  });

  it('keeps human-in-the-loop examples mapped to wait_for_human', () => {
    expect(sys.toLowerCase()).toContain('solve the captcha');
    expect(sys.toLowerCase()).toContain('pause for user input');
  });

  it('tells the parser to use a short default duration when none is given', () => {
    expect(sys).toMatch(/no duration is given/i);
  });
});

// ── verdict / report-style extract intent ─────────────────────────────────────
// Bug (T-0110 prompt half): an extract phrased as a verdict/report
// ("report PAGE_OK if the heading is shown, or PAGE_FAILED with the error")
// has no page-data to scrape. The generic extract prompt frames the task as
// "extract data FROM THE PAGE; return [] if nothing found", so the model
// correctly emits literal []. The verdict token the user asked for is lost at
// the source, before any parser can help.
//
// Fix (Option A, prompt-only): makeExtractInstructionMessage / …Dom must detect
// verdict/report intent and instruct the model to emit the verdict token as a
// data record — WITHOUT changing behavior for ordinary data-extraction.

import { makeExtractInstructionMessageDom } from '../../../src/utils/prompts.js';

describe('makeExtractInstructionMessage — verdict / report intent', () => {
  const snapshot = '- heading "Example Domain"';

  // General verdict phrasings — not over-fit to the literal "PAGE_OK" token.
  const verdictPrompts = [
    'report PAGE_OK if the heading is shown, or PAGE_FAILED with the exact error text',
    'return LOGIN_OK if logged in, otherwise LOGIN_FAILED',
    'respond with STATUS_GREEN or STATUS_RED depending on the banner',
  ];

  for (const builder of [
    ['aria', makeExtractInstructionMessage],
    ['dom', makeExtractInstructionMessageDom],
  ]) {
    const [mode, make] = builder;

    for (const prompt of verdictPrompts) {
      it(`${mode}: verdict prompt guides the model to emit the verdict token as a record — "${prompt.slice(0, 24)}…"`, () => {
        const sys = make(prompt, snapshot)[0].content;
        // The prompt must instruct emitting the verdict/report token as data,
        // rather than only "extract data from the page; return [] if none".
        expect(sys.toLowerCase()).toContain('verdict');
        // And it must NOT tell the model an empty array is the answer for a
        // verdict — that is exactly what produced the lost verdict.
        expect(sys).toMatch(/report|verdict/i);
      });
    }

    it(`${mode}: a normal data-extract prompt keeps the plain extraction framing (no verdict guidance)`, () => {
      const sys = make('extract the price of each product', snapshot)[0].content;
      // Ordinary extraction is unchanged: still frames "if nothing found,
      // return empty array".
      expect(sys).toContain('If nothing found, return empty array: []');
      // No verdict-specific block leaks into ordinary extraction.
      expect(sys.toLowerCase()).not.toContain('verdict');
    });
  }
});

// ── verdict detection must not over-trigger on "status" as a plain noun ────────
// Bug (T-0114): isVerdictExtractPrompt routed ANY extract that paired a reporting
// verb (report/return/…) with the lowercase substring "status"/"verdict" into
// verdict mode. Legitimate multi-row data extractions —
//   "return the order status for each row in the table"
//   "report the current status of each shipment"
// — then wrongly got VERDICT_EXTRACT_GUIDANCE, which tells the model to emit ONE
// {"verdict":TOKEN} object and NEVER an array, silently degrading a real list
// extraction to a single token.
//
// Fix direction: the status/verdict cue word ALONE must not trigger. Gate on a
// real verdict signal — an UPPER_SNAKE / uppercase status TOKEN (PAGE_OK,
// LOGIN_FAILED) or an explicit "X or Y" report shape. "status"/"verdict" as a
// plain lowercase noun in a data-extraction phrase falls through to normal
// extraction. Do NOT overcorrect into missing genuine verdicts.

describe('makeExtractInstructionMessage — verdict detection is not over-broad (status noun)', () => {
  const snapshot = '- table "orders"';

  // Legitimate multi-row data extractions that merely mention "status" as a
  // lowercase noun. These must NOT be routed to verdict mode.
  const falsePositives = [
    'return the order status for each row in the table',
    'report the current status of each shipment',
    'output the delivery status of every order',
    'return the verdict column for each judgement in the list',
  ];

  // Genuine verdicts that MUST keep verdict guidance — general over tokens,
  // covering both the "token present" and the explicit "X or Y" shapes.
  const genuineVerdicts = [
    'report PAGE_OK if the heading "Example Domain" is shown, or PAGE_FAILED with the exact error text',
    'return LOGIN_OK if logged in, otherwise LOGIN_FAILED',
    'report LOGIN_OK or LOGIN_FAILED',
  ];

  for (const [mode, make] of [
    ['aria', makeExtractInstructionMessage],
    ['dom', makeExtractInstructionMessageDom],
  ]) {
    for (const prompt of falsePositives) {
      it(`${mode}: data extract mentioning "status"/"verdict" as a noun stays normal — "${prompt.slice(0, 28)}…"`, () => {
        const sys = make(prompt, snapshot)[0].content;
        // The plain extraction framing is intact — no verdict block appended.
        expect(sys).toContain('If nothing found, return empty array: []');
        expect(sys.toLowerCase()).not.toContain('verdict / report mode');
        expect(sys.toLowerCase()).not.toContain('"verdict"');
      });
    }

    for (const prompt of genuineVerdicts) {
      it(`${mode}: genuine verdict still gets verdict guidance — "${prompt.slice(0, 28)}…"`, () => {
        const sys = make(prompt, snapshot)[0].content;
        expect(sys.toLowerCase()).toContain('verdict');
        expect(sys).toContain('VERDICT / REPORT MODE');
      });
    }
  }
});

// ── orShape must not misfire on enumerated field lists ────────────────────────
// Bug (T-0118): the orShape branch of isVerdictExtractPrompt matches a report
// verb + two adjacent ALL-CAPS words joined by literal " or " and routes to
// verdict mode (forces ONE {verdict:TOKEN} object, never an array). This
// false-positives on legitimate MULTI-ITEM data extractions where the CAPS pair
// is a set of candidate FIELD NAMES inside a larger "extract N things"
// instruction ("report the ISBN or SKU for each book"). Collapsing those to a
// single token silently drops the list — the very failure orShape set out to
// prevent, via a different phrasing.
//
// The tell of a GENUINE binary verdict "X or Y" is that the whole instruction IS
// the choice between two status/outcome tokens: no list/enumeration framing, and
// the tokens are the reported value itself — not adjectives modifying a following
// field noun. A data extraction pairs the CAPS as candidate field names, marked
// by an enumeration cue ("for each", "every", "of each", "per row") and/or a
// lowercase content noun the CAPS modify ("USD or EUR price", "Q1 or Q2
// revenue"). The fix excludes that class from the orShape branch WITHOUT touching
// the STATUS_TOKEN (UPPER_SNAKE / OK|FAILED|…) or bare-token verdict paths.

describe('makeExtractInstructionMessage — orShape must not fire on enumerated field lists', () => {
  const snapshot = '- table "rows"';

  // Multi-item data extractions whose CAPS pair is a candidate field-name list,
  // not a binary verdict. General over the class — enumeration cues and/or a
  // lowercase field noun the CAPS modify. Must stay NORMAL extraction.
  const orShapeFalsePositives = [
    'report the ISBN or SKU for each book',
    'report the USD or EUR price for each product',
    'return the GET or POST method from each row',
    'report the Q1 or Q2 revenue',
    'return the FIRST or LAST name',
    'report each ROW or COLUMN header',
    'return the SEDOL or CUSIP code of each holding',
    'report the MIN or MAX temperature',
    'return the HTTP or HTTPS url',
    'report the USD or EUR prices',
  ];

  // Genuine binary verdicts phrased as "X or Y" — the whole clause IS the choice
  // between two outcome tokens. Must KEEP verdict guidance. Covers short tokens
  // the keyword list does not enumerate (GREEN/RED) plus trailing condition
  // qualifiers ("depending on the banner") that are NOT field nouns.
  const orShapeGenuineVerdicts = [
    'report LOGIN_OK or LOGIN_FAILED',
    'return GREEN or RED',
    'respond with STATUS_GREEN or STATUS_RED depending on the banner',
    'report PAGE_OK or PAGE_FAILED',
    'return YES or NO',
  ];

  for (const [mode, make] of [
    ['aria', makeExtractInstructionMessage],
    ['dom', makeExtractInstructionMessageDom],
  ]) {
    for (const prompt of orShapeFalsePositives) {
      it(`${mode}: enumerated field-list "X or Y" stays normal extraction — "${prompt.slice(0, 30)}…"`, () => {
        const sys = make(prompt, snapshot)[0].content;
        expect(sys).toContain('If nothing found, return empty array: []');
        expect(sys).not.toContain('VERDICT / REPORT MODE');
        expect(sys.toLowerCase()).not.toContain('"verdict"');
      });
    }

    for (const prompt of orShapeGenuineVerdicts) {
      it(`${mode}: genuine binary "X or Y" verdict still gets guidance — "${prompt.slice(0, 30)}…"`, () => {
        const sys = make(prompt, snapshot)[0].content;
        expect(sys).toContain('VERDICT / REPORT MODE');
        expect(sys.toLowerCase()).toContain('verdict');
      });
    }
  }
});

// ── template-literal integrity — no trailing backslash artifacts ──────────────
// Regression: prior to fix, template literals contained trailing \ chars which
// would cause syntax errors or mangled string values.

describe('prompts — no trailing backslash in message content (template literal fix)', () => {
  const fns = [
    ['makeTaskDescriptionMessage', () => makeTaskDescriptionMessage('go to https://x.com')],
    ['makeFindInstructionMessage', () => makeFindInstructionMessage('find login', '{}')],
    ['makeActionInstructionMessage', () => makeActionInstructionMessage('click submit', '{}')],
    ['makeExtractInstructionMessage', () => makeExtractInstructionMessage('extract rows', '{}')],
  ];

  for (const [name, factory] of fns) {
    it(`${name}: no message content line ends with a lone backslash`, () => {
      const msgs = factory();
      for (const msg of msgs) {
        // A trailing \ in a template literal causes the string to end with \
        expect(msg.content).not.toMatch(/\\$/m);
      }
    });

    it(`${name}: system prompt is a non-empty string`, () => {
      const msgs = factory();
      expect(typeof msgs[0].content).toBe('string');
      expect(msgs[0].content.length).toBeGreaterThan(0);
    });
  }
});

// ── makeFindInstructionWithDiffMessage ────────────────────────────────────────

describe('makeFindInstructionWithDiffMessage', () => {
  const fullDom = '{"n":"body","c":[]}';

  it('falls back to makeFindInstructionMessage when diff is null', () => {
    const withNull = makeFindInstructionWithDiffMessage('find button', null, fullDom);
    const plain = makeFindInstructionMessage('find button', fullDom);
    expect(withNull).toEqual(plain);
  });

  it('falls back to makeFindInstructionMessage when diff is undefined', () => {
    const withUndef = makeFindInstructionWithDiffMessage('find input', undefined, fullDom);
    const plain = makeFindInstructionMessage('find input', fullDom);
    expect(withUndef).toEqual(plain);
  });

  it('returns diff-aware message when diff is provided', () => {
    const diff = { added: [], removed: [], modified: [], largeChange: false };
    const msgs = makeFindInstructionWithDiffMessage('find submit', diff, fullDom);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('Diff:');
  });

  it('user message contains the prompt when diff is provided', () => {
    const diff = { added: [{ path: '/HTML/BODY/BUTTON', n: 'BUTTON' }], removed: [], modified: [] };
    const msgs = makeFindInstructionWithDiffMessage('click the button', diff, fullDom);
    expect(msgs[1].content).toContain('click the button');
  });

  it('system prompt does NOT end with a lone backslash (template literal integrity)', () => {
    const diff = { added: [], removed: [], modified: [] };
    const msgs = makeFindInstructionWithDiffMessage('find nav', diff, fullDom);
    expect(msgs[0].content).not.toMatch(/\\$/m);
  });
});
