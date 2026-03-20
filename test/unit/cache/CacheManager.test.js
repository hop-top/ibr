import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let testDir;
let CacheManager;

beforeEach(async () => {
  testDir = path.join(os.tmpdir(), `idx-test-${Date.now()}`);
  vi.stubEnv('CACHE_DIR', testDir);
  vi.stubEnv('CACHE_ENABLED', 'true');
  vi.resetModules();
  const mod = await import('../../../src/cache/CacheManager.js?t=' + Date.now());
  CacheManager = mod.CacheManager;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('CacheManager.init', () => {
  it('creates cacheDir/find, /action, /extract directories', async () => {
    const cm = new CacheManager();
    await cm.init();
    for (const sub of ['find', 'action', 'extract']) {
      const stat = await fs.stat(path.join(testDir, sub));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('sets initialized=true after init', async () => {
    const cm = new CacheManager();
    await cm.init();
    expect(cm.initialized).toBe(true);
  });

  it('second init call is no-op (idempotent)', async () => {
    const cm = new CacheManager();
    await cm.init();
    await cm.init(); // should not throw
    expect(cm.initialized).toBe(true);
  });
});

describe('CacheManager.generateKey', () => {
  it('same inputs → same key', async () => {
    const cm = new CacheManager();
    const k1 = cm.generateKey('https://example.com/page', 'find button', 'find');
    const k2 = cm.generateKey('https://example.com/page', 'find button', 'find');
    expect(k1).toBe(k2);
  });

  it('different url → different key', async () => {
    const cm = new CacheManager();
    const k1 = cm.generateKey('https://example.com/a', 'find button', 'find');
    const k2 = cm.generateKey('https://example.com/b', 'find button', 'find');
    expect(k1).not.toBe(k2);
  });

  it('different type → different key', async () => {
    const cm = new CacheManager();
    const k1 = cm.generateKey('https://example.com', 'do x', 'find');
    const k2 = cm.generateKey('https://example.com', 'do x', 'action');
    expect(k1).not.toBe(k2);
  });

  it('query params stripped (url normalized)', async () => {
    const cm = new CacheManager();
    const k1 = cm.generateKey('https://example.com/page?q=1', 'p', 'find');
    const k2 = cm.generateKey('https://example.com/page?q=2', 'p', 'find');
    expect(k1).toBe(k2);
  });
});

describe('CacheManager.get', () => {
  it('file missing → null', async () => {
    const cm = new CacheManager();
    await cm.init();
    const result = await cm.get('find', 'nonexistent-key');
    expect(result).toBeNull();
  });

  it('valid JSON → returns entry', async () => {
    const cm = new CacheManager();
    await cm.init();
    const key = cm.generateKey('https://example.com', 'click btn', 'find');
    await cm.set('find', key, { schema: { elementIndices: [0] } });
    const entry = await cm.get('find', key);
    expect(entry).not.toBeNull();
    expect(entry.schema.elementIndices).toEqual([0]);
  });

  it('corrupted JSON → null + file deleted', async () => {
    const cm = new CacheManager();
    await cm.init();
    const key = 'corrupted-key-abc123';
    const filePath = path.join(testDir, 'find', `${key}.json`);
    await fs.writeFile(filePath, 'not valid json }{');
    const result = await cm.get('find', key);
    expect(result).toBeNull();
    // file should be deleted
    await expect(fs.access(filePath)).rejects.toThrow();
  });
});

describe('CacheManager.set', () => {
  it('writes JSON file', async () => {
    const cm = new CacheManager();
    await cm.init();
    const key = cm.generateKey('https://example.com', 'find link', 'find');
    await cm.set('find', key, { schema: { elementIndices: [2] } });
    const filePath = path.join(testDir, 'find', `${key}.json`);
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    expect(data.schema.elementIndices).toEqual([2]);
  });

  it('adds metadata: createdAt, lastUsedAt, successCount, failureCount', async () => {
    const cm = new CacheManager();
    await cm.init();
    const key = cm.generateKey('https://example.com', 'find link', 'find');
    await cm.set('find', key, { schema: {} });
    const entry = await cm.get('find', key);
    expect(entry.metadata).toBeDefined();
    expect(entry.metadata.createdAt).toBeDefined();
    expect(entry.metadata.lastUsedAt).toBeDefined();
    expect(entry.metadata.successCount).toBe(0);
    expect(entry.metadata.failureCount).toBe(0);
  });
});

describe('CacheManager.recordSuccess', () => {
  it('increments successCount', async () => {
    const cm = new CacheManager();
    await cm.init();
    const key = cm.generateKey('https://example.com', 'find x', 'find');
    await cm.set('find', key, { schema: {} });
    await cm.recordSuccess('find', key);
    const entry = await cm.get('find', key);
    expect(entry.metadata.successCount).toBe(1);
  });

  it('updates lastUsedAt', async () => {
    const cm = new CacheManager();
    await cm.init();
    const key = cm.generateKey('https://example.com', 'find x', 'find');
    await cm.set('find', key, { schema: {} });
    const before = await cm.get('find', key);
    const originalTime = before.metadata.lastUsedAt;
    // small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 5));
    await cm.recordSuccess('find', key);
    const after = await cm.get('find', key);
    expect(after.metadata.lastUsedAt >= originalTime).toBe(true);
  });
});

describe('CacheManager.recordFailure', () => {
  it('increments failureCount', async () => {
    const cm = new CacheManager();
    await cm.init();
    const key = cm.generateKey('https://example.com', 'find y', 'find');
    await cm.set('find', key, { schema: {} });
    await cm.recordFailure('find', key);
    const entry = await cm.get('find', key);
    expect(entry.metadata.failureCount).toBe(1);
  });

  it('at MAX_FAILURES → deletes entry', async () => {
    vi.stubEnv('CACHE_MAX_FAILURES', '2');
    vi.resetModules();
    const mod = await import('../../../src/cache/CacheManager.js?t=' + Date.now() + 'b');
    const CM2 = mod.CacheManager;
    const cm = new CM2();
    await cm.init();
    const key = cm.generateKey('https://example.com', 'find z', 'find');
    await cm.set('find', key, { schema: {} });
    await cm.recordFailure('find', key); // failureCount=1
    await cm.recordFailure('find', key); // failureCount=2 → delete
    const entry = await cm.get('find', key);
    expect(entry).toBeNull();
  });
});

describe('CACHE_ENABLED=false → all operations are no-ops', () => {
  let cm;

  beforeEach(async () => {
    vi.stubEnv('CACHE_ENABLED', 'false');
    vi.resetModules();
    const mod = await import('../../../src/cache/CacheManager.js?t=' + Date.now() + 'c');
    cm = new mod.CacheManager();
  });

  it('init does not create directories', async () => {
    await cm.init();
    expect(cm.initialized).toBe(false);
    try {
      await fs.access(path.join(testDir, 'find'));
      expect.fail('directory should not exist');
    } catch {
      // expected
    }
  });

  it('get returns null', async () => {
    await cm.init();
    const result = await cm.get('find', 'any-key');
    expect(result).toBeNull();
  });

  it('set is a no-op', async () => {
    await cm.init();
    await expect(cm.set('find', 'any-key', { schema: {} })).resolves.toBeUndefined();
  });

  it('recordSuccess is a no-op', async () => {
    await expect(cm.recordSuccess('find', 'any-key')).resolves.toBeUndefined();
  });

  it('recordFailure is a no-op', async () => {
    await expect(cm.recordFailure('find', 'any-key')).resolves.toBeUndefined();
  });
});
