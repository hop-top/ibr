import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const downloaderMock = vi.hoisted(() => ({
  resolveVersion: vi.fn(),
  download: vi.fn(),
}));

vi.mock('../../../src/browser/downloader.js', () => downloaderMock);

let testCacheRoot;
let acquirer;
let cache;
let probeDir;

beforeEach(async () => {
  testCacheRoot = path.join(
    os.tmpdir(),
    `ibr-acquirer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  probeDir = path.join(os.tmpdir(), `ibr-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(probeDir, { recursive: true });
  vi.stubEnv('XDG_CACHE_HOME', testCacheRoot);
  vi.resetModules();
  downloaderMock.resolveVersion.mockReset();
  downloaderMock.download.mockReset();
  cache = await import('../../../src/browser/cache.js?t=' + Date.now());
  acquirer = await import('../../../src/browser/acquirer.js?t=' + Date.now());
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  for (const d of [testCacheRoot, probeDir]) {
    try {
      await fs.rm(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function makeEntry(overrides = {}) {
  return {
    id: 'lightpanda',
    downloadable: true,
    localProbe: [],
    releases: { provider: 'github', repo: 'lightpanda-io/browser', channels: {} },
    ...overrides,
  };
}

// All acquire calls in this file default to platform='linux' so they
// behave identically on any CI host (the entry.id === 'lightpanda' +
// win32 hard-gate would otherwise fire on Windows runners and mask the
// test's real assertion). The dedicated win32 test below overrides this.
async function doAcquire(entry, opts = {}) {
  return acquirer.acquire(entry, { platform: 'linux', ...opts });
}

describe('acquirer.acquire — probe', () => {
  it('returns probe hit early', async () => {
    const probePath = path.join(probeDir, 'lightpanda');
    await fs.writeFile(probePath, 'fake-bin');
    const result = await doAcquire(makeEntry({ localProbe: [probePath] }));
    expect(result.source).toBe('probe');
    expect(result.executablePath).toBe(probePath);
    expect(downloaderMock.resolveVersion).not.toHaveBeenCalled();
  });

  it('throws on miss when not downloadable', async () => {
    await expect(
      doAcquire(makeEntry({ downloadable: false, localProbe: ['/nope/x'] })),
    ).rejects.toThrow(/not downloadable/);
  });
});

describe('acquirer.acquire — download chain', () => {
  it('downloads on cache miss and returns source=download', async () => {
    downloaderMock.resolveVersion.mockResolvedValue({
      version: '0.2.8',
      assetUrl: 'http://x/y',
      sha256: 'sha',
      requireChecksum: false,
      channel: 'stable',
    });
    downloaderMock.download.mockImplementation(async (entry, channel, args) => {
      const dir = cache.versionDir(channel, args.version);
      await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
      const exe = path.join(dir, 'bin', 'lightpanda');
      await fs.writeFile(exe, 'bin');
      const meta = { sha256: 'sha', size: 3, downloadedAt: new Date().toISOString(), sourceUrl: 'http://x/y', requireChecksum: false };
      await cache.writeMeta(channel, args.version, meta);
      return { executablePath: exe, meta };
    });
    const result = await doAcquire(makeEntry(), { env: {} });
    expect(result.source).toBe('download');
    expect(result.version).toBe('0.2.8');
    expect(downloaderMock.download).toHaveBeenCalledTimes(1);
  });

  it('returns cached on hit (no download)', async () => {
    downloaderMock.resolveVersion.mockResolvedValue({
      version: '0.2.8',
      assetUrl: 'http://x/y',
      sha256: 'sha',
      requireChecksum: false,
      channel: 'stable',
    });
    // Pre-populate cache
    const dir = cache.versionDir('stable', '0.2.8');
    await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
    await fs.writeFile(path.join(dir, 'bin', 'lp'), 'bin');
    await cache.writeMeta('stable', '0.2.8', {
      sha256: 'sha',
      size: 3,
      downloadedAt: new Date().toISOString(),
      sourceUrl: 'http://x/y',
      requireChecksum: false,
    });

    const result = await doAcquire(makeEntry(), { env: {} });
    expect(result.source).toBe('cache');
    expect(downloaderMock.download).not.toHaveBeenCalled();
  });

  it('re-checks cache after acquiring lock (second caller sees cache hit)', async () => {
    downloaderMock.resolveVersion.mockResolvedValue({
      version: '0.2.8',
      assetUrl: 'http://x/y',
      sha256: 'sha',
      requireChecksum: false,
      channel: 'stable',
    });
    let downloadCount = 0;
    downloaderMock.download.mockImplementation(async (entry, channel, args) => {
      downloadCount += 1;
      // Simulate slow download
      await new Promise((r) => setTimeout(r, 100));
      const dir = cache.versionDir(channel, args.version);
      await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
      const exe = path.join(dir, 'bin', 'lp');
      await fs.writeFile(exe, 'bin');
      const meta = {
        sha256: 'sha',
        size: 3,
        downloadedAt: new Date().toISOString(),
        sourceUrl: 'http://x/y',
        requireChecksum: false,
      };
      await cache.writeMeta(channel, args.version, meta);
      return { executablePath: exe, meta };
    });

    const [r1, r2] = await Promise.all([
      doAcquire(makeEntry(), { env: {} }),
      doAcquire(makeEntry(), { env: {} }),
    ]);
    expect(downloadCount).toBe(1);
    const sources = [r1.source, r2.source].sort();
    expect(sources).toEqual(['cache', 'download']);
  });
});

describe('acquirer.acquire — platform gating', () => {
  it('throws on win32 + lightpanda', async () => {
    await expect(
      acquirer.acquire(makeEntry(), { platform: 'win32' }),
    ).rejects.toThrow(/Lightpanda is not supported on Windows/);
  });

  it('does not gate non-lightpanda entries on win32', async () => {
    // Regression: the win32 gate must only fire for entry.id === 'lightpanda'.
    // A non-lightpanda entry on Windows must still go through probe/cache
    // normally.
    const probePath = path.join(probeDir, 'fake-browser');
    await fs.writeFile(probePath, 'bin');
    const result = await acquirer.acquire(
      makeEntry({ id: 'fake', localProbe: [probePath] }),
      { platform: 'win32' },
    );
    expect(result.source).toBe('probe');
    expect(result.executablePath).toBe(probePath);
  });
});
