import { describe, it, expect } from 'vitest';
import {
  makeTaskDescriptionMessage,
  makeFindInstructionMessage,
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
