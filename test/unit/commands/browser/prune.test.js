/**
 * Unit tests for src/commands/browser/prune.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let testCacheRoot;
let pruneCmd;
let cache;
let stdoutSpy;
let stderrSpy;

beforeEach(async () => {
  testCacheRoot = path.join(
    os.tmpdir(),
    `ibr-prune-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  vi.stubEnv('XDG_CACHE_HOME', testCacheRoot);
  vi.resetModules();
  cache = await import('../../../../src/browser/cache.js?t=' + Date.now());
  pruneCmd = await import('../../../../src/commands/browser/prune.js?t=' + Date.now());
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
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

async function seedVersion(channel, version, downloadedAt) {
  const dir = cache.versionDir(channel, version);
  await fs.mkdir(path.join(dir, 'bin'), { recursive: true });
  await fs.writeFile(path.join(dir, 'bin', 'browser'), 'fake');
  await cache.writeMeta(channel, version, {
    sha256: 'sha',
    size: 4,
    downloadedAt,
    sourceUrl: 'http://x',
    requireChecksum: false,
  });
}

describe('parseDuration', () => {
  it('parses days/weeks/hours/minutes', () => {
    expect(pruneCmd.parseDuration('30d')).toBe(30 * 86400 * 1000);
    expect(pruneCmd.parseDuration('2w')).toBe(14 * 86400 * 1000);
    expect(pruneCmd.parseDuration('6h')).toBe(6 * 3600 * 1000);
    expect(pruneCmd.parseDuration('15m')).toBe(15 * 60 * 1000);
  });
  it('throws on invalid input', () => {
    expect(() => pruneCmd.parseDuration('foo')).toThrow(/invalid duration/);
    expect(() => pruneCmd.parseDuration('30')).toThrow(/invalid duration/);
    expect(() => pruneCmd.parseDuration('')).toThrow(/invalid duration/);
  });
});

describe('browser prune', () => {
  it('prints help with --help', async () => {
    const code = await pruneCmd.run(['--help']);
    expect(code).toBe(0);
    expect(stdoutSpy.mock.calls.join('')).toContain('Usage: ibr browser prune');
  });

  it('default keep-N: removes versions beyond keep=5', async () => {
    const now = Date.now();
    for (let i = 0; i < 7; i++) {
      // newer index = newer time
      // eslint-disable-next-line no-await-in-loop
      await seedVersion('stable', `0.0.${i}`, new Date(now - (10 - i) * 1000).toISOString());
    }
    const code = await pruneCmd.run(['--channel', 'stable']);
    expect(code).toBe(0);
    const remaining = await cache.listVersions('stable');
    expect(remaining).toHaveLength(5);
    expect(stdoutSpy.mock.calls.join('')).toContain('removed');
  });

  it('--older-than removes by age', async () => {
    const now = Date.now();
    await seedVersion('stable', '0.0.1', new Date(now - 40 * 86400 * 1000).toISOString());
    await seedVersion('stable', '0.0.2', new Date(now - 1 * 86400 * 1000).toISOString());

    const code = await pruneCmd.run(['--channel', 'stable', '--older-than', '30d']);
    expect(code).toBe(0);
    const remaining = await cache.listVersions('stable');
    expect(remaining.map((v) => v.version)).toEqual(['0.0.2']);
  });

  it('--dry-run does not delete anything', async () => {
    const now = Date.now();
    await seedVersion('stable', '0.0.1', new Date(now - 40 * 86400 * 1000).toISOString());
    await seedVersion('stable', '0.0.2', new Date(now - 1 * 86400 * 1000).toISOString());

    const code = await pruneCmd.run(['--channel', 'stable', '--older-than', '30d', '--dry-run']);
    expect(code).toBe(0);
    const remaining = await cache.listVersions('stable');
    expect(remaining).toHaveLength(2);
    expect(stdoutSpy.mock.calls.join('')).toContain('would remove');
  });

  it('errors with code 2 on bad duration', async () => {
    const code = await pruneCmd.run(['--older-than', 'huh']);
    expect(code).toBe(2);
    expect(stderrSpy.mock.calls.join('')).toContain('invalid duration');
  });

  it('walks all channels when --channel omitted', async () => {
    const old = new Date(Date.now() - 365 * 86400 * 1000).toISOString();
    await seedVersion('stable', '0.0.1', old);
    await seedVersion('nightly', '0.0.1', old);
    const code = await pruneCmd.run(['--older-than', '30d']);
    expect(code).toBe(0);
    expect(await cache.listVersions('stable')).toHaveLength(0);
    expect(await cache.listVersions('nightly')).toHaveLength(0);
  });
});
