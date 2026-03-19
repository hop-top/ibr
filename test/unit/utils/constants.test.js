import { describe, it, expect } from 'vitest';
import {
  PAGE_LOADING_DELAY_MS,
  INSTRUCTION_EXECUTION_DELAY_MS,
  INSTRUCTION_EXECUTION_JITTER_MS,
} from '../../../src/utils/constants.js';

describe('constants', () => {
  describe('PAGE_LOADING_DELAY_MS', () => {
    it('is exported', () => {
      expect(PAGE_LOADING_DELAY_MS).toBeDefined();
    });

    it('is a number', () => {
      expect(typeof PAGE_LOADING_DELAY_MS).toBe('number');
    });

    it('is >= 0', () => {
      expect(PAGE_LOADING_DELAY_MS).toBeGreaterThanOrEqual(0);
    });
  });

  describe('INSTRUCTION_EXECUTION_DELAY_MS', () => {
    it('is exported', () => {
      expect(INSTRUCTION_EXECUTION_DELAY_MS).toBeDefined();
    });

    it('is a number', () => {
      expect(typeof INSTRUCTION_EXECUTION_DELAY_MS).toBe('number');
    });

    it('is >= 0', () => {
      expect(INSTRUCTION_EXECUTION_DELAY_MS).toBeGreaterThanOrEqual(0);
    });
  });

  describe('INSTRUCTION_EXECUTION_JITTER_MS', () => {
    it('is exported', () => {
      expect(INSTRUCTION_EXECUTION_JITTER_MS).toBeDefined();
    });

    it('is a number', () => {
      expect(typeof INSTRUCTION_EXECUTION_JITTER_MS).toBe('number');
    });

    it('is >= 0', () => {
      expect(INSTRUCTION_EXECUTION_JITTER_MS).toBeGreaterThanOrEqual(0);
    });
  });

  it('vitest env sets all delays to 0 for fast tests', () => {
    expect(PAGE_LOADING_DELAY_MS).toBe(0);
    expect(INSTRUCTION_EXECUTION_DELAY_MS).toBe(0);
    expect(INSTRUCTION_EXECUTION_JITTER_MS).toBe(0);
  });
});
