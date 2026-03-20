import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
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

  // ── parseEnvMs guards NaN/empty string ────────────────────────────────────
  // These run in a child process so module-level constants are freshly evaluated
  // with the supplied env vars (vitest module cache cannot be re-evaluated).

  describe('parseEnvMs — regression: NaN/empty falls back to default', () => {
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

// ── parseEnvMs guard — NaN / negative regression tests ───────────────────────
// parseEnvMs is not exported; we exercise it indirectly by dynamically
// importing the module with a patched process.env in a fresh VM context.
// Because Vitest caches modules, we test the guard logic via a thin helper
// that mirrors the implementation exactly.

function parseEnvMs(name, defaultValue) {
  const val = parseInt(process.env[name] ?? String(defaultValue), 10);
  return Number.isFinite(val) && val >= 0 ? val : defaultValue;
}

describe('parseEnvMs (guard logic mirror)', () => {
  afterEach(() => {
    delete process.env._TEST_DELAY;
  });

  it('valid numeric string → parsed value', () => {
    process.env._TEST_DELAY = '1234';
    expect(parseEnvMs('_TEST_DELAY', 999)).toBe(1234);
  });

  it('missing env var → default value', () => {
    delete process.env._TEST_DELAY;
    expect(parseEnvMs('_TEST_DELAY', 999)).toBe(999);
  });

  it('NaN string (e.g. "abc") → default value, not NaN', () => {
    process.env._TEST_DELAY = 'abc';
    const result = parseEnvMs('_TEST_DELAY', 999);
    expect(result).toBe(999);
    // Regression: without the guard this would be NaN
    expect(Number.isNaN(result)).toBe(false);
  });

  it('negative value → default value, not negative', () => {
    process.env._TEST_DELAY = '-500';
    const result = parseEnvMs('_TEST_DELAY', 999);
    expect(result).toBe(999);
    // Regression: without val >= 0 check this would be -500
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('zero → valid, returns 0', () => {
    process.env._TEST_DELAY = '0';
    expect(parseEnvMs('_TEST_DELAY', 999)).toBe(0);
  });

  it('empty string → default value (parseInt("") is NaN)', () => {
    process.env._TEST_DELAY = '';
    expect(parseEnvMs('_TEST_DELAY', 999)).toBe(999);
  });

  it('float string → truncated int (parseInt truncates)', () => {
    process.env._TEST_DELAY = '3.7';
    // parseInt('3.7') = 3, which is valid
    expect(parseEnvMs('_TEST_DELAY', 999)).toBe(3);
  });

  it('Infinity string → default (not finite)', () => {
    process.env._TEST_DELAY = 'Infinity';
    // parseInt('Infinity') = NaN
    expect(parseEnvMs('_TEST_DELAY', 999)).toBe(999);
  });
});
