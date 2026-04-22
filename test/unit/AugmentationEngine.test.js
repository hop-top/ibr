import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AugmentationEngine } from '../../src/services/AugmentationEngine.js';

describe('AugmentationEngine', () => {
  const testTmpDir = path.join(os.tmpdir(), `ibr-test-${Date.now()}`);
  const testFilePath = path.join(testTmpDir, 'augmentations.json');

  beforeEach(async () => {
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true });
  });

  it('should initialize empty if file missing', async () => {
    const engine = new AugmentationEngine({ filePath: testFilePath });
    await engine.init();
    expect(engine.rules).toEqual([]);
    expect(engine.initialized).toBe(true);
  });

  it('should load rules from disk', async () => {
    const store = {
      version: 1,
      rules: [
        { id: 'test-rule', urlPattern: 'example\\.com', priority: 100 }
      ]
    };
    await fs.writeFile(testFilePath, JSON.stringify(store));

    const engine = new AugmentationEngine({ filePath: testFilePath });
    await engine.init();
    expect(engine.rules.length).toBe(1);
    expect(engine.rules[0].id).toBe('test-rule');
  });

  it('should match rules for URL using regex', async () => {
    const engine = new AugmentationEngine({ filePath: testFilePath });
    engine.rules = [
      { id: 'match', urlPattern: 'github\\.com/.*', priority: 100 },
      { id: 'no-match', urlPattern: 'google\\.com', priority: 100 }
    ];
    engine.initialized = true;

    const matches = engine.getRulesForUrl('https://github.com/hop-top/ibr');
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe('match');
  });

  it('should sort rules by priority', async () => {
    const engine = new AugmentationEngine({ filePath: testFilePath });
    engine.rules = [
      { id: 'low', urlPattern: '.*', priority: 10 },
      { id: 'high', urlPattern: '.*', priority: 1000 },
      { id: 'medium', urlPattern: '.*', priority: 100 }
    ];
    engine.initialized = true;

    const matches = engine.getRulesForUrl('https://example.com');
    expect(matches[0].id).toBe('high');
    expect(matches[1].id).toBe('medium');
    expect(matches[2].id).toBe('low');
  });

  it('should skip rules with too many failure votes', async () => {
    const engine = new AugmentationEngine({ filePath: testFilePath });
    engine.rules = [
      { id: 'failed', urlPattern: '.*', priority: 100, telemetry: { failureVotes: 3 } },
      { id: 'ok', urlPattern: '.*', priority: 100, telemetry: { failureVotes: 0 } }
    ];
    engine.initialized = true;

    const matches = engine.getRulesForUrl('https://example.com');
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe('ok');
  });

  it('should record failure votes', async () => {
    const engine = new AugmentationEngine({ filePath: testFilePath });
    engine.rules = [
      { id: 'test', urlPattern: '.*', priority: 100 }
    ];
    engine.initialized = true;

    await engine.recordFailure('test');
    expect(engine.rules[0].telemetry.failureVotes).toBe(1);
    expect(engine.rules[0].telemetry.lastFailureAt).toBeDefined();

    // Verify it saved to disk
    const data = await fs.readFile(testFilePath, 'utf8');
    const store = JSON.parse(data);
    expect(store.rules[0].telemetry.failureVotes).toBe(1);
  });

  it('should record success and reset votes', async () => {
    const engine = new AugmentationEngine({ filePath: testFilePath });
    engine.rules = [
      { id: 'test', urlPattern: '.*', priority: 100, telemetry: { failureVotes: 2 } }
    ];
    engine.initialized = true;

    await engine.recordSuccess('test');
    expect(engine.rules[0].telemetry.failureVotes).toBe(0);
    expect(engine.rules[0].telemetry.lastVerified).toBeDefined();
  });
});
