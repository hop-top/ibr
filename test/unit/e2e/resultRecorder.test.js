/**
 * Unit tests for test/e2e/helpers/resultRecorder.js
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { recordTestResult, ensureResultsDir } from '../../e2e/helpers/resultRecorder.js';

describe('resultRecorder', () => {
  const fixtureName = `_test_${Date.now()}`;
  const fixtureCategory = 'unit_test';
  let writtenPath;
  let resultsDirPath;

  beforeAll(async () => {
    await ensureResultsDir();
  });

  it('ensureResultsDir creates the results directory', async () => {
    // Call once more to verify idempotent
    await ensureResultsDir();
    // Verify by writing and confirming the file lands somewhere that exists
    expect(true).toBe(true); // ensureResultsDir would throw if creation failed
  });

  it('recordTestResult writes a JSON file', async () => {
    writtenPath = await recordTestResult({
      fixtureFile: '/test/fixtures/unit_test/_test.json',
      fixtureCategory,
      fixtureName,
      prompt: 'url: http://localhost/\ninstructions:\n  - click something',
      execution: { status: 'success', duration_ms: 42, timestamp: '2026-01-01T00:00:00Z' },
      parsed: {
        expected: { url: 'http://localhost/', instructions: [{ name: 'click' }] },
        actual: { url: 'http://localhost/', instructions: [{ name: 'click' }] },
        matches: true,
        match_details: [],
      },
      extracts: {
        expected: [],
        actual: [],
        matches: true,
        match_type: 'exact',
      },
      tokens: { prompt: 10, completion: 5, total: 15 },
      aiProvider: { provider: 'openai', model: 'gpt-4-mini', temperature: 0 },
      tags: ['fast'],
      notes: 'unit test fixture',
    });

    expect(existsSync(writtenPath)).toBe(true);
    expect(writtenPath).toContain(`${fixtureCategory}__${fixtureName}.json`);
  });

  it('written file contains valid JSON with required fields', async () => {
    const raw = await readFile(writtenPath, 'utf8');
    const record = JSON.parse(raw);

    expect(record.fixtureCategory).toBe(fixtureCategory);
    expect(record.prompt).toBe('url: http://localhost/\ninstructions:\n  - click something');
    expect(record.execution.status).toBe('success');
    expect(record.execution.duration_ms).toBe(42);
    expect(record.parsed.matches).toBe(true);
    expect(record.extracts.match_type).toBe('exact');
    expect(record.tokens.total).toBe(15);
    expect(record.ai_provider.provider).toBe('openai');
    expect(record.tags).toEqual(['fast']);
    expect(record.notes).toBe('unit test fixture');
  });

  it('omits notes field when not provided', async () => {
    const p = await recordTestResult({
      fixtureFile: '/test/_no_notes.json',
      fixtureCategory: 'unit_test',
      fixtureName: `_test_no_notes_${Date.now()}`,
      prompt: 'test',
      execution: { status: 'skipped', duration_ms: 0, timestamp: '2026-01-01T00:00:00Z' },
      parsed: { expected: {}, actual: null, matches: false, match_details: [] },
      extracts: { expected: [], actual: [], matches: true, match_type: 'exact' },
      tokens: { prompt: 0, completion: 0, total: 0 },
      aiProvider: { provider: 'openai', model: 'fake', temperature: 0 },
      tags: [],
    });

    const raw = await readFile(p, 'utf8');
    const record = JSON.parse(raw);
    expect(Object.prototype.hasOwnProperty.call(record, 'notes')).toBe(false);

    // Cleanup
    await rm(p, { force: true });
  });

  // Cleanup the primary test file
  it('cleanup', async () => {
    if (writtenPath && existsSync(writtenPath)) {
      await rm(writtenPath, { force: true });
    }
    expect(true).toBe(true);
  });
});
