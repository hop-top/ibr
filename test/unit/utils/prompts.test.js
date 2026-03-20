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
