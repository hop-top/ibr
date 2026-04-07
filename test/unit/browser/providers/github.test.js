import { describe, it, expect, vi } from 'vitest';
import { resolveChannel } from '../../../../src/browser/providers/github.js';

const REPO = 'lightpanda-io/browser';

const CHANNELS = {
  nightly: {
    resolver: 'tag',
    tag: 'nightly',
    assetPattern: 'lightpanda-{arch}-{os}',
    requireChecksum: false,
  },
  stable: {
    resolver: 'newest-non-prerelease',
    assetPattern: 'lightpanda-{arch}-{os}',
    requireChecksum: true,
  },
  latest: {
    resolver: 'alias',
    aliasOf: 'stable',
    requireChecksum: true,
  },
};

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function textResponse(text, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('not json');
    },
    text: async () => text,
  };
}

function makeAsset(name, url) {
  return { name, browser_download_url: url || `https://dl/${name}` };
}

function makeRelease({ tag, prerelease = false, published_at, assets = [] }) {
  return {
    tag_name: tag,
    prerelease,
    published_at: published_at || '2026-04-06T12:00:00Z',
    assets,
  };
}

const DARWIN_ARM = { platform: 'darwin', arch: 'arm64' };

describe('github provider — resolveChannel', () => {
  it('stable: picks newest non-prerelease, normalizes v-prefix', async () => {
    const releases = [
      makeRelease({
        tag: 'v0.3.0-beta',
        prerelease: true,
        published_at: '2026-04-05T00:00:00Z',
        assets: [makeAsset('lightpanda-aarch64-macos')],
      }),
      makeRelease({
        tag: 'v0.2.8',
        prerelease: false,
        published_at: '2026-04-04T00:00:00Z',
        assets: [makeAsset('lightpanda-aarch64-macos', 'https://dl/v028')],
      }),
      makeRelease({
        tag: 'v0.2.6',
        prerelease: false,
        published_at: '2026-03-01T00:00:00Z',
        assets: [makeAsset('lightpanda-aarch64-macos')],
      }),
    ];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(releases));
    const r = await resolveChannel(REPO, 'stable', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.version).toBe('0.2.8');
    expect(r.tag).toBe('v0.2.8');
    expect(r.assetUrl).toBe('https://dl/v028');
    expect(r.requireChecksum).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toContain('/releases?per_page=30');
  });

  it('nightly: tag lookup, version is nightly-YYYY-MM-DD', async () => {
    const release = makeRelease({
      tag: 'nightly',
      published_at: '2026-04-06T18:30:00Z',
      assets: [makeAsset('lightpanda-aarch64-macos', 'https://dl/n')],
    });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(release));
    const r = await resolveChannel(REPO, 'nightly', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.version).toBe('nightly-2026-04-06');
    expect(r.assetUrl).toBe('https://dl/n');
    expect(r.requireChecksum).toBe(false);
    expect(fetchFn.mock.calls[0][0]).toContain('/releases/tags/nightly');
  });

  it('latest: alias for stable', async () => {
    const releases = [
      makeRelease({
        tag: '0.2.8',
        assets: [makeAsset('lightpanda-aarch64-macos')],
      }),
    ];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(releases));
    const r = await resolveChannel(REPO, 'latest', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.version).toBe('0.2.8');
    expect(fetchFn.mock.calls[0][0]).toContain('/releases?per_page=30');
  });

  it('alias cycle guard: throws after max depth', async () => {
    const cyclic = {
      a: { resolver: 'alias', aliasOf: 'b' },
      b: { resolver: 'alias', aliasOf: 'a' },
    };
    const fetchFn = vi.fn();
    await expect(
      resolveChannel(REPO, 'a', cyclic, { fetchFn, ...DARWIN_ARM }),
    ).rejects.toThrow(/alias chain too deep/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('exact version with v prefix: tries v0.2.6 first', async () => {
    const release = makeRelease({
      tag: 'v0.2.6',
      assets: [makeAsset('lightpanda-aarch64-macos', 'https://dl/v026')],
    });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(release));
    const r = await resolveChannel(REPO, 'v0.2.6', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.version).toBe('0.2.6');
    expect(fetchFn.mock.calls[0][0]).toContain('/releases/tags/v0.2.6');
  });

  it('exact version without v prefix: tries 0.2.8 first then v0.2.8', async () => {
    const release = makeRelease({
      tag: 'v0.2.8',
      assets: [makeAsset('lightpanda-aarch64-macos', 'https://dl/v028')],
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse(release));
    const r = await resolveChannel(REPO, '0.2.8', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.version).toBe('0.2.8');
    expect(fetchFn.mock.calls[0][0]).toContain('/releases/tags/0.2.8');
    expect(fetchFn.mock.calls[1][0]).toContain('/releases/tags/v0.2.8');
  });

  it('asset match: darwin+arm64 → aarch64-macos partial match', async () => {
    const release = makeRelease({
      tag: 'v0.2.8',
      assets: [
        makeAsset('lightpanda-x86_64-linux'),
        makeAsset('lightpanda-aarch64-macos.tar.gz', 'https://dl/match'),
      ],
    });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([release]));
    const r = await resolveChannel(REPO, 'stable', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.assetUrl).toBe('https://dl/match');
  });

  it('asset mismatch: throws with clear message listing assets', async () => {
    const release = makeRelease({
      tag: 'v0.2.8',
      assets: [makeAsset('something-else.zip')],
    });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([release]));
    await expect(
      resolveChannel(REPO, 'stable', CHANNELS, { fetchFn, ...DARWIN_ARM }),
    ).rejects.toThrow(/no asset matching "lightpanda-aarch64-macos".*something-else\.zip/);
  });

  it('checksum via .sha256 sidecar: fetched and lowercased', async () => {
    const SHA = 'AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899';
    const binName = 'lightpanda-aarch64-macos';
    const release = makeRelease({
      tag: 'v0.2.8',
      assets: [
        makeAsset(binName, 'https://dl/bin'),
        makeAsset(`${binName}.sha256`, 'https://dl/sha'),
      ],
    });
    const fetchFn = vi.fn(async (url) => {
      if (url === 'https://dl/sha') return textResponse(`${SHA}  ${binName}\n`);
      return jsonResponse([release]);
    });
    const r = await resolveChannel(REPO, 'stable', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.sha256).toBe(SHA.toLowerCase());
  });

  it('checksum via SHA256SUMS: parses correct line', async () => {
    const SHA_BIN = 'a'.repeat(64);
    const SHA_OTHER = 'b'.repeat(64);
    const binName = 'lightpanda-aarch64-macos';
    const release = makeRelease({
      tag: 'v0.2.8',
      assets: [
        makeAsset(binName, 'https://dl/bin'),
        makeAsset('SHA256SUMS', 'https://dl/sums'),
      ],
    });
    const sumsText = `${SHA_OTHER}  lightpanda-x86_64-linux\n${SHA_BIN}  ${binName}\n`;
    const fetchFn = vi.fn(async (url) => {
      if (url === 'https://dl/sums') return textResponse(sumsText);
      return jsonResponse([release]);
    });
    const r = await resolveChannel(REPO, 'stable', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.sha256).toBe(SHA_BIN);
  });

  it('no checksum present: returns sha256: null', async () => {
    const release = makeRelease({
      tag: 'v0.2.8',
      assets: [makeAsset('lightpanda-aarch64-macos', 'https://dl/bin')],
    });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([release]));
    const r = await resolveChannel(REPO, 'stable', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.sha256).toBeNull();
  });

  it('win32: throws before any fetch', async () => {
    const fetchFn = vi.fn();
    await expect(
      resolveChannel(REPO, 'stable', CHANNELS, {
        fetchFn,
        platform: 'win32',
        arch: 'x64',
      }),
    ).rejects.toThrow(/not supported on Windows/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('unsupported arch: throws with supported list', async () => {
    const fetchFn = vi.fn();
    await expect(
      resolveChannel(REPO, 'stable', CHANNELS, {
        fetchFn,
        platform: 'freebsd',
        arch: 'x64',
      }),
    ).rejects.toThrow(/unsupported platform\/arch/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('HTTP 429 retry: succeeds after one retry', async () => {
    const release = makeRelease({
      tag: 'v0.2.8',
      assets: [makeAsset('lightpanda-aarch64-macos', 'https://dl/bin')],
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => '',
      })
      .mockResolvedValueOnce(jsonResponse([release]));
    const r = await resolveChannel(REPO, 'stable', CHANNELS, { fetchFn, ...DARWIN_ARM });
    expect(r.version).toBe('0.2.8');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
