import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as path from 'path';
import {
  PAGE_LOADING_DELAY_MS,
  INSTRUCTION_EXECUTION_DELAY_MS,
  INSTRUCTION_EXECUTION_JITTER_MS,
} from '../../../src/utils/constants.js';

// Helper: import constants.js in a fresh Node process with the given env
// vars, returning the exported values via stdout JSON.
function evalConstants(env) {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const script = [
    `import('./src/utils/constants.js').then(m => {`,
    `  process.stdout.write(JSON.stringify({`,
    `    PAGE_LOADING_DELAY_MS: m.PAGE_LOADING_DELAY_MS,`,
    `    INSTRUCTION_EXECUTION_DELAY_MS: m.INSTRUCTION_EXECUTION_DELAY_MS,`,
    `    INSTRUCTION_EXECUTION_JITTER_MS: m.INSTRUCTION_EXECUTION_JITTER_MS,`,
    `  }));`,
    `});`,
  ].join('\n');
  const out = execFileSync(
    process.execPath,
    ['--input-type=module'],
    {
      input: script,
      encoding: 'utf-8',
      env: { ...process.env, ...env },
      cwd: root,
    }
  );
  return JSON.parse(out);
}

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

  // ── Fix 3: parseNonNegativeIntOrDefault guards NaN/empty string ────────────
  // These run in a child process so module-level constants are freshly evaluated
  // with the supplied env vars (vitest module cache cannot be re-evaluated).

  describe('parseNonNegativeIntOrDefault — regression: NaN/empty falls back to default', () => {
    it('empty string → falls back to hard-coded default (2500 / 2000 / 500)', () => {
      const vals = evalConstants({
        PAGE_LOADING_DELAY_MS: '',
        INSTRUCTION_EXECUTION_DELAY_MS: '',
        INSTRUCTION_EXECUTION_JITTER_MS: '',
      });
      expect(vals.PAGE_LOADING_DELAY_MS).toBe(2500);
      expect(vals.INSTRUCTION_EXECUTION_DELAY_MS).toBe(2000);
      expect(vals.INSTRUCTION_EXECUTION_JITTER_MS).toBe(500);
    });

    it('non-numeric string → falls back to hard-coded default', () => {
      const vals = evalConstants({
        PAGE_LOADING_DELAY_MS: 'banana',
        INSTRUCTION_EXECUTION_DELAY_MS: 'NaN',
        INSTRUCTION_EXECUTION_JITTER_MS: 'undefined',
      });
      expect(vals.PAGE_LOADING_DELAY_MS).toBe(2500);
      expect(vals.INSTRUCTION_EXECUTION_DELAY_MS).toBe(2000);
      expect(vals.INSTRUCTION_EXECUTION_JITTER_MS).toBe(500);
    });

    it('negative integer → falls back to hard-coded default', () => {
      const vals = evalConstants({
        PAGE_LOADING_DELAY_MS: '-1',
        INSTRUCTION_EXECUTION_DELAY_MS: '-500',
        INSTRUCTION_EXECUTION_JITTER_MS: '-100',
      });
      expect(vals.PAGE_LOADING_DELAY_MS).toBe(2500);
      expect(vals.INSTRUCTION_EXECUTION_DELAY_MS).toBe(2000);
      expect(vals.INSTRUCTION_EXECUTION_JITTER_MS).toBe(500);
    });

    it('valid non-negative integer → uses supplied value', () => {
      const vals = evalConstants({
        PAGE_LOADING_DELAY_MS: '100',
        INSTRUCTION_EXECUTION_DELAY_MS: '200',
        INSTRUCTION_EXECUTION_JITTER_MS: '50',
      });
      expect(vals.PAGE_LOADING_DELAY_MS).toBe(100);
      expect(vals.INSTRUCTION_EXECUTION_DELAY_MS).toBe(200);
      expect(vals.INSTRUCTION_EXECUTION_JITTER_MS).toBe(50);
    });

    it('zero → uses zero (zero is valid, not a fallback)', () => {
      const vals = evalConstants({
        PAGE_LOADING_DELAY_MS: '0',
        INSTRUCTION_EXECUTION_DELAY_MS: '0',
        INSTRUCTION_EXECUTION_JITTER_MS: '0',
      });
      expect(vals.PAGE_LOADING_DELAY_MS).toBe(0);
      expect(vals.INSTRUCTION_EXECUTION_DELAY_MS).toBe(0);
      expect(vals.INSTRUCTION_EXECUTION_JITTER_MS).toBe(0);
    });
  });
});
