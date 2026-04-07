import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const providerMock = vi.hoisted(() => ({
  resolveChannel: vi.fn(),
}));

vi.mock('../../../src/browser/providers/github.js', () => providerMock);

let testCacheRoot;
let downloader;
let cache;

beforeEach(async () => {
  testCacheRoot = path.join(
    os.tmpdir(),
    `ibr-downloader-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  vi.stubEnv('XDG_CACHE_HOME', testCacheRoot);
  vi.resetModules();
  providerMock.resolveChannel.mockReset();
  cache = await import('../../../src/browser/cache.js?t=' + Date.now());
  downloader = await import('../../../src/browser/downloader.js?t=' + Date.now());
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  try {
    await fs.rm(testCacheRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function makeEntry(overrides = {}) {
  return {
    id: 'lightpanda',
    downloadable: true,
    releases: {
      provider: 'github',
      repo: 'lightpanda-io/browser',
      channels: { stable: {}, nightly: {} },
      requireChecksum: false,
    },
    ...overrides,
  };
}

function makeFetchResponse(buffer, { status = 200, contentLength } = {}) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => {
        if (k.toLowerCase() === 'content-length') return String(contentLength ?? buffer.length);
        return null;
      },
    },
    body: stream,
  };
}

describe('downloader.resolveVersion', () => {
  it('handles stable channel via provider', async () => {
    providerMock.resolveChannel.mockResolvedValue({
      tag: 'v0.2.8',
      assetUrl: 'http://x/asset.tar.gz',
      sha256: 'abc',
    });
    const r = await downloader.resolveVersion(makeEntry(), 'stable', { env: {} });
    expect(r.version).toBe('0.2.8');
    expect(r.assetUrl).toBe('http://x/asset.tar.gz');
    expect(r.sha256).toBe('abc');
    expect(r.channel).toBe('stable');
  });

  it('handles nightly channel via provider', async () => {
    providerMock.resolveChannel.mockResolvedValue({
      tag: 'nightly-2026-04-06',
      assetUrl: 'http://x/n.tar.gz',
      sha256: null,
    });
    const r = await downloader.resolveVersion(makeEntry(), 'nightly', { env: {} });
    expect(r.version).toBe('nightly-2026-04-06');
    expect(r.channel).toBe('nightly');
  });

  it('treats `latest` as alias for stable', async () => {
    providerMock.resolveChannel.mockResolvedValue({
      tag: '0.2.8',
      assetUrl: 'http://x/a',
    });
    const r = await downloader.resolveVersion(makeEntry(), 'latest', { env: {} });
    expect(r.channel).toBe('stable');
    expect(providerMock.resolveChannel).toHaveBeenCalledWith(
      'lightpanda-io/browser',
      'stable',
      expect.any(Object),
    );
  });

  it('strips v prefix on exact version', async () => {
    providerMock.resolveChannel.mockResolvedValue({
      tag: 'v0.2.6',
      assetUrl: 'http://x/v.tar',
      sha256: 'd',
    });
    const r = await downloader.resolveVersion(makeEntry(), 'v0.2.6', { env: {} });
    expect(r.version).toBe('0.2.6');
  });

  it('BROWSER_DOWNLOAD_URL → synthetic version', async () => {
    const r = await downloader.resolveVersion(makeEntry(), 'stable', {
      env: { BROWSER_DOWNLOAD_URL: 'http://override/blob' },
    });
    expect(r.version).toMatch(/^custom-[0-9a-f]{12}$/);
    expect(r.assetUrl).toBe('http://override/blob');
    expect(r.requireChecksum).toBe(false);
    expect(providerMock.resolveChannel).not.toHaveBeenCalled();
  });

  it('TTL cache hit bypasses provider', async () => {
    await cache.writeResolved('stable', {
      stable: {
        version: '0.2.8',
        assetUrl: 'http://cached/x',
        sha256: 'cached',
        resolvedAt: new Date().toISOString(),
        ttlMs: 60_000,
      },
    });
    const r = await downloader.resolveVersion(makeEntry(), 'stable', { env: {} });
    expect(r.version).toBe('0.2.8');
    expect(r.assetUrl).toBe('http://cached/x');
    expect(providerMock.resolveChannel).not.toHaveBeenCalled();
  });

  it('falls back to last-known on provider failure', async () => {
    await cache.writeResolved('stable', {
      stable: {
        version: '0.2.7',
        assetUrl: 'http://stale/x',
        sha256: 'old',
        resolvedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        ttlMs: 60_000,
      },
    });
    providerMock.resolveChannel.mockRejectedValue(new Error('network down'));
    const r = await downloader.resolveVersion(makeEntry(), 'stable', { env: {} });
    expect(r.version).toBe('0.2.7');
    expect(r.assetUrl).toBe('http://stale/x');
  });

  it('first run no-network → throws', async () => {
    providerMock.resolveChannel.mockRejectedValue(new Error('ENETUNREACH'));
    await expect(
      downloader.resolveVersion(makeEntry(), 'stable', { env: {} }),
    ).rejects.toThrow(/unable to resolve channel/);
  });
});

describe('downloader.download', () => {
  const payload = Buffer.from('hello-binary');
  const sha256 = crypto.createHash('sha256').update(payload).digest('hex');

  it('streams to .partial, verifies sha, atomic renames, chmods, writes meta', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(payload));
    const result = await downloader.download(
      makeEntry(),
      'stable',
      {
        version: '0.2.8',
        assetUrl: 'http://x/lightpanda-macos.tar.gz',
        sha256,
        requireChecksum: true,
      },
      { env: {} },
    );
    expect(result.executablePath).toBe(
      path.join(cache.versionDir('stable', '0.2.8'), 'lightpanda-macos.tar.gz'),
    );
    expect(result.meta.sha256).toBe(sha256);
    expect(result.meta.size).toBe(payload.length);
    // No partial left behind
    const dirEntries = await fs.readdir(cache.versionDir('stable', '0.2.8'));
    expect(dirEntries.some((n) => n.endsWith('.partial'))).toBe(false);
    // Meta file present
    expect(dirEntries).toContain('meta.json');
    // chmod (non-win32)
    if (process.platform !== 'win32') {
      const st = fsSync.statSync(result.executablePath);
      expect(st.mode & 0o111).not.toBe(0);
    }
  });

  it('checksum mismatch throws and leaves no partial', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(payload));
    await expect(
      downloader.download(
        makeEntry(),
        'stable',
        {
          version: '0.2.9',
          assetUrl: 'http://x/asset.bin',
          sha256: 'deadbeef'.padEnd(64, '0'),
          requireChecksum: true,
        },
        { env: {} },
      ),
    ).rejects.toThrow(/sha256 mismatch/);
    // No partial left
    let entries = [];
    try {
      entries = await fs.readdir(cache.versionDir('stable', '0.2.9'));
    } catch {
      // dir may not exist
    }
    expect(entries.some((n) => n.endsWith('.partial'))).toBe(false);
  });

  it('requireChecksum:true + missing sha → throws', async () => {
    global.fetch = vi.fn();
    await expect(
      downloader.download(
        makeEntry(),
        'stable',
        {
          version: '0.2.8',
          assetUrl: 'http://x/y',
          sha256: null,
          requireChecksum: true,
        },
        { env: {} },
      ),
    ).rejects.toThrow(/requireChecksum/);
  });

  it('BROWSER_REQUIRE_CHECKSUM=true forces refusal when sha missing', async () => {
    global.fetch = vi.fn();
    await expect(
      downloader.download(
        makeEntry(),
        'stable',
        {
          version: '0.2.8',
          assetUrl: 'http://x/y',
          sha256: null,
          requireChecksum: false,
        },
        { env: { BROWSER_REQUIRE_CHECKSUM: 'true' } },
      ),
    ).rejects.toThrow(/BROWSER_REQUIRE_CHECKSUM/);
  });

  it('records sha when none provided (best-effort meta)', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeFetchResponse(payload));
    const result = await downloader.download(
      makeEntry(),
      'stable',
      {
        version: '0.2.10',
        assetUrl: 'http://x/asset.tar',
        sha256: null,
        requireChecksum: false,
      },
      { env: {} },
    );
    expect(result.meta.sha256).toBe(sha256);
  });
});
