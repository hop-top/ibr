/**
 * Regression (T-0115): condition-split leaves a BARE verdict token as the child
 * extract prompt.
 *
 * When the parser splits "report PAGE_OK if <cond>, or PAGE_FAILED …" into a
 * CONDITION instruction plus a bare extract whose prompt is just "PAGE_OK" (and
 * the failure token on the failure path), that child prompt has NO report verb.
 * isVerdictExtractPrompt therefore did NOT fire → the extract system prompt used
 * the ordinary page-data framing → the model returned literal [] → verdict lost.
 *
 * Fix: a prompt that IS a bare uppercase status token is verdict intent even
 * without a verb, so the split child extract carries verdict guidance regardless
 * of which way the LLM split the instruction. This must NOT change ordinary
 * data-extraction, and must not treat a bare lowercase word as a verdict.
 */

import { describe, it, expect } from 'vitest';
import {
  makeExtractInstructionMessage,
  makeExtractInstructionMessageDom,
} from '../../../src/utils/prompts.js';

describe('makeExtractInstructionMessage — bare verdict token (condition-split child)', () => {
  const snapshot = '- heading "Example Domain"';

  // General over tokens — UPPER_SNAKE and enumerated short tokens.
  const bareTokens = ['PAGE_OK', 'PAGE_FAILED', 'LOGIN_FAILED', 'STATUS_GREEN', 'FAILED'];

  // A bare lowercase word (ordinary extract target) is NOT a verdict.
  const notVerdicts = ['heading', 'the price of each product', 'all table rows'];

  for (const [mode, make] of [
    ['aria', makeExtractInstructionMessage],
    ['dom', makeExtractInstructionMessageDom],
  ]) {
    for (const token of bareTokens) {
      it(`${mode}: bare token "${token}" (no verb) carries verdict guidance`, () => {
        const sys = make(token, snapshot)[0].content;
        expect(sys.toLowerCase()).toContain('verdict');
        expect(sys).toContain('VERDICT / REPORT MODE');
      });
    }

    for (const target of notVerdicts) {
      it(`${mode}: ordinary target "${target.slice(0, 20)}" stays normal extraction`, () => {
        const sys = make(target, snapshot)[0].content;
        expect(sys).toContain('If nothing found, return empty array: []');
        expect(sys.toLowerCase()).not.toContain('verdict / report mode');
      });
    }
  }
});
