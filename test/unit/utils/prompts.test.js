import { describe, it, expect } from 'vitest';
import {
  makeTaskDescriptionMessage,
  makeFindInstructionMessage,
  makeFindInstructionWithDiffMessage,
  makeActionInstructionMessage,
  makeExtractInstructionMessage,
} from '../../../src/utils/prompts.js';

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
