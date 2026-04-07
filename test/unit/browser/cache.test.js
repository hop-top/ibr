import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let testCacheRoot;
let cache;

beforeEach(async () => {
  testCacheRoot = path.join(os.tmpdir(), `ibr-browser-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  vi.stubEnv('XDG_CACHE_HOME', testCacheRoot);
  vi.resetModules();
  cache = await import('../../../src/browser/cache.js?t=' + Date.now());
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  try {
    await fs.rm(testCacheRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('cache.cacheRoot', () => {
  it('honors XDG_CACHE_HOME', () => {
    expect(cache.cacheRoot()).toBe(path.join(testCacheRoot, 'ibr', 'browsers'));
  });

  it('falls back to $HOME/.cache when XDG unset', async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const mod = await import('../../../src/browser/cache.js?t=' + Date.now() + 'a');
    expect(mod.cacheRoot()).toBe(path.join(os.homedir(), '.cache', 'ibr', 'browsers'));
  });
});

describe('cache.channelDir + versionDir', () => {
  it('produces channelDir under cacheRoot', () => {
    const p = cache.channelDir('stable');
    expect(p).toBe(path.join(cache.cacheRoot(), 'stable'));
  });

  it('produces versionDir under channelDir', () => {
    const p = cache.versionDir('stable', '0.2.8');
    expect(p).toBe(path.join(cache.channelDir('stable'), '0.2.8'));
  });
});

describe('cache.findCached', () => {
  it('returns null on miss', async () => {
    const result = await cache.findCached('stable', '0.2.8');
    expect(result).toBeNull();
  });

  it('returns executablePath + meta on hit (bin/ layout)', async () => {
    const dir = cache.versionDir('stable', '0.2.8');
    await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
    await fs.writeFile(path.join(dir, 'bin', 'lightpanda'), 'fake-binary');
    await cache.writeMeta('stable', '0.2.8', {
      sha256: 'abc',
      size: 11,
      downloadedAt: new Date().toISOString(),
      sourceUrl: 'http://example.com/x',
      requireChecksum: false,
    });
    const result = await cache.findCached('stable', '0.2.8');
    expect(result).not.toBeNull();
    expect(result.executablePath).toBe(path.join(dir, 'bin', 'lightpanda'));
    expect(result.meta.sha256).toBe('abc');
  });

  it('falls back to scanning version dir for binary', async () => {
    const dir = cache.versionDir('stable', '0.2.9');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'lightpanda-macos'), 'bin');
    await cache.writeMeta('stable', '0.2.9', { sha256: 'x', size: 3, downloadedAt: new Date().toISOString(), sourceUrl: 'u', requireChecksum: false });
    const result = await cache.findCached('stable', '0.2.9');
    expect(result.executablePath).toBe(path.join(dir, 'lightpanda-macos'));
  });
});

describe('cache.listVersions', () => {
  it('returns empty when channel dir missing', async () => {
    const result = await cache.listVersions('stable');
    expect(result).toEqual([]);
  });

  it('sorts newest first', async () => {
    await cache.writeMeta('stable', '0.1.0', {
      sha256: 'a',
      size: 100,
      downloadedAt: '2026-01-01T00:00:00.000Z',
      sourceUrl: 'u',
      requireChecksum: false,
    });
    await cache.writeMeta('stable', '0.2.0', {
      sha256: 'b',
      size: 200,
      downloadedAt: '2026-03-01T00:00:00.000Z',
      sourceUrl: 'u',
      requireChecksum: false,
    });
    const versions = await cache.listVersions('stable');
    expect(versions.map((v) => v.version)).toEqual(['0.2.0', '0.1.0']);
    expect(versions[0].sizeBytes).toBe(200);
  });
});

describe('cache.readResolved / writeResolved / isResolvedFresh', () => {
  it('roundtrips resolved.json', async () => {
    const data = {
      stable: {
        version: '0.2.8',
        assetUrl: 'http://example.com/x',
        resolvedAt: new Date().toISOString(),
        ttlMs: 86_400_000,
      },
    };
    await cache.writeResolved('stable', data);
    const round = await cache.readResolved('stable');
    expect(round.stable.version).toBe('0.2.8');
  });

  it('returns empty object on ENOENT', async () => {
    const r = await cache.readResolved('nightly');
    expect(r).toEqual({});
  });

  it('isResolvedFresh respects TTL', () => {
    const fresh = {
      version: 'x',
      resolvedAt: new Date().toISOString(),
      ttlMs: 60_000,
    };
    expect(cache.isResolvedFresh(fresh)).toBe(true);

    const stale = {
      version: 'x',
      resolvedAt: new Date(Date.now() - 120_000).toISOString(),
      ttlMs: 60_000,
    };
    expect(cache.isResolvedFresh(stale)).toBe(false);

    expect(cache.isResolvedFresh(null)).toBe(false);
    expect(cache.isResolvedFresh({})).toBe(false);
  });
});

describe('cache.pruneOldVersions', () => {
  it('keeps newest N and removes older', async () => {
    for (let i = 0; i < 7; i++) {
      await cache.writeMeta('stable', `0.${i}.0`, {
        sha256: 's',
        size: i,
        downloadedAt: new Date(2026, 0, i + 1).toISOString(),
        sourceUrl: 'u',
        requireChecksum: false,
      });
    }
    const removed = await cache.pruneOldVersions('stable', { keep: 3 });
    expect(removed.versions.sort()).toEqual(['0.0.0', '0.1.0', '0.2.0', '0.3.0']);
    const remaining = await cache.listVersions('stable');
    expect(remaining.map((v) => v.version).sort()).toEqual(['0.4.0', '0.5.0', '0.6.0']);
  });

  it('removes .partial orphans at channel level', async () => {
    const chDir = cache.channelDir('stable');
    await fs.mkdir(chDir, { recursive: true });
    const orphan = path.join(chDir, 'leftover.tar.gz.partial');
    await fs.writeFile(orphan, 'partial');
    const removed = await cache.pruneOldVersions('stable', { keep: 5 });
    expect(removed.partials).toContain('leftover.tar.gz.partial');
    await expect(fs.stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes stale lock files', async () => {
    const chDir = cache.channelDir('stable');
    await fs.mkdir(chDir, { recursive: true });
    const lock = path.join(chDir, 'old.lock');
    await fs.writeFile(lock, 'stale');
    // Set mtime to 2h ago
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(lock, past, past);
    const removed = await cache.pruneOldVersions('stable', { keep: 5 });
    expect(removed.locks).toContain('old.lock');
  });

  it('keeps fresh lock files', async () => {
    const chDir = cache.channelDir('stable');
    await fs.mkdir(chDir, { recursive: true });
    const lock = path.join(chDir, 'fresh.lock');
    await fs.writeFile(lock, 'fresh');
    const removed = await cache.pruneOldVersions('stable', { keep: 5 });
    expect(removed.locks).not.toContain('fresh.lock');
    expect((await fs.stat(lock)).isFile()).toBe(true);
  });
});
