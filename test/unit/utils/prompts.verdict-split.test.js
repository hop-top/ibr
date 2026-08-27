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

/**
 * Regression (T-0119): the bare-token verdict branch also matched a bare
 * UPPER_SNAKE *data field name*. "PAGE_OK" and "ORDER_ID" are lexically the
 * same shape (an UPPER_SNAKE token), so the anchored BARE_STATUS_TOKEN could
 * not tell them apart and forced a data-field child extract into verdict mode
 * — emitting one {"verdict":"ORDER_ID"} object instead of scraping that field's
 * value.
 *
 * Distinction found in this codebase: every real verdict token is an OUTCOME
 * word (…_OK / …_FAILED / …_ERROR / …_GREEN / …_RED / NOT_FOUND / the
 * enumerated short tokens); data fields end in identifier/field suffixes
 * (_ID, _SKU, _CODE, _NAME, _URL, _KEY, _PATH). No robust positive verdict
 * allowlist exists (verdict tokens are open-ended), but a bare token whose
 * final segment is one of those identifier suffixes is a field, not a verdict.
 * Fix: exclude the identifier-suffix class from the bare-token verdict branch.
 * Genuine bare verdict tokens (none of which use those suffixes) still route to
 * verdict mode — the load-bearing condition-split behavior is preserved.
 */
describe('makeExtractInstructionMessage — bare identifier-field token is NOT a verdict (T-0119)', () => {
  const snapshot = '- heading "Example Domain"';

  // Bare UPPER_SNAKE tokens ending in an identifier/field suffix — these name
  // a DATA FIELD the model should scrape, NOT a status verdict to emit.
  const identifierFields = [
    'ORDER_ID',
    'PRODUCT_SKU',
    'ZIP_CODE',
    'USER_ID',
    'FULL_NAME',
    'TARGET_URL',
    'API_KEY',
    'FILE_PATH',
  ];

  // Bare genuine verdict tokens — these MUST still route to verdict mode; the
  // condition-split success/failure path depends on it.
  const genuineBareVerdicts = ['PAGE_OK', 'PAGE_FAILED', 'LOGIN_FAILED', 'LOGIN_OK', 'STATUS_GREEN', 'FAILED'];

  for (const [mode, make] of [
    ['aria', makeExtractInstructionMessage],
    ['dom', makeExtractInstructionMessageDom],
  ]) {
    for (const field of identifierFields) {
      it(`${mode}: bare identifier field "${field}" stays normal extraction (no verdict)`, () => {
        const sys = make(field, snapshot)[0].content;
        expect(sys).toContain('If nothing found, return empty array: []');
        expect(sys.toLowerCase()).not.toContain('verdict / report mode');
        expect(sys.toLowerCase()).not.toContain('"verdict"');
      });
    }

    for (const token of genuineBareVerdicts) {
      it(`${mode}: bare verdict token "${token}" still carries verdict guidance`, () => {
        const sys = make(token, snapshot)[0].content;
        expect(sys.toLowerCase()).toContain('verdict');
        expect(sys).toContain('VERDICT / REPORT MODE');
      });
    }
  }
});
