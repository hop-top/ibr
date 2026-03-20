/**
 * Unit tests for test/e2e/helpers/resultRecorder.js (T-0015).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordTestResult, ensureResultsDir } from '../../e2e/helpers/resultRecorder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_ROOT = resolve(__dirname, '../../results/e2e');

// Clean up written files after each test
const written = [];

afterEach(async () => {
  for (const fp of written) {
    try { await rm(fp, { force: true }); } catch { /* ignore */ }
  }
  written.length = 0;
});

function makeResult(overrides = {}) {
  return {
    fixtureFile: '/path/to/fixture.json',
    fixtureCategory: 'instruction_types',
    fixtureName: 'click-basic',
    prompt: 'url: http://localhost/login\ninstructions:\n  - click the login button',
    execution: { status: 'success', duration_ms: 1234, timestamp: '2026-03-20T12:00:00.000Z' },
    parsed: {
      expected: { url: 'http://localhost/login', instructions: [] },
      actual: { url: 'http://localhost/login', instructions: [] },
      matches: true,
      match_details: [],
      parse_error: '',
    },
    extracts: {
      expected: [],
      actual: [],
      matches: true,
      match_type: 'structural',
      structural_notes: '',
      extract_error: '',
    },
    tokens: { prompt: 100, completion: 50, total: 150 },
    ai_provider: { provider: 'openai', model: 'gpt-4-mini', temperature: 0 },
    tags: ['fast'],
    notes: 'test note',
    ...overrides,
  };
}

describe('recordTestResult()', () => {
  it('writes a JSON file to test/results/e2e/', async () => {
    const fp = await recordTestResult(makeResult());
    written.push(fp);

    const raw = await readFile(fp, 'utf8');
    const data = JSON.parse(raw);

    expect(data.fixtureCategory).toBe('instruction_types');
    expect(data.fixtureName).toBeUndefined(); // not in output schema
    expect(data.execution.status).toBe('success');
    expect(data.execution.duration_ms).toBe(1234);
    expect(data.tokens.total).toBe(150);
    expect(data.tags).toEqual(['fast']);
  });

  it('names the file <category>-<name>.json', async () => {
    const fp = await recordTestResult(makeResult({ fixtureName: 'my-fixture' }));
    written.push(fp);
    expect(fp).toMatch(/instruction_types-my-fixture\.json$/);
  });

  it('fills defaults for missing optional fields', async () => {
    const fp = await recordTestResult({
      fixtureFile: '/x.json',
      fixtureCategory: 'edge_cases',
      fixtureName: 'empty',
      prompt: 'url: http://localhost/',
    });
    written.push(fp);

    const data = JSON.parse(await readFile(fp, 'utf8'));
    expect(data.execution.status).toBe('error');
    expect(data.parsed.matches).toBe(false);
    expect(data.extracts.match_type).toBe('structural');
    expect(data.tokens.total).toBe(0);
    expect(data.tags).toEqual([]);
    expect(data.notes).toBe('');
  });

  it('is idempotent — overwrites existing file', async () => {
    const base = makeResult();
    const fp1 = await recordTestResult(base);
    written.push(fp1);

    const base2 = makeResult({ execution: { status: 'error', duration_ms: 9999, timestamp: '2026-03-20T13:00:00.000Z' } });
    const fp2 = await recordTestResult(base2);
    written.push(fp2);

    expect(fp1).toBe(fp2);
    const data = JSON.parse(await readFile(fp1, 'utf8'));
    expect(data.execution.status).toBe('error');
    expect(data.execution.duration_ms).toBe(9999);
  });
});

describe('ensureResultsDir()', () => {
  it('resolves without error when dir already exists', async () => {
    await expect(ensureResultsDir()).resolves.toBeUndefined();
  });
});
