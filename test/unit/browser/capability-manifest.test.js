/**
 * Tests for capability-manifest.js (T-0031).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  versionKey,
  loadManifest,
  saveManifest,
  isKnownBroken,
  recordBroken,
  pruneOldVersionKeys,
  fingerprintError,
  detectPlaywrightVersion,
} from '../../../src/browser/capability-manifest.js';

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ibr-cap-mf-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('versionKey', () => {
  it('joins lp + pw with a pipe', () => {
    expect(versionKey('1.2.3', '1.52.0')).toBe('1.2.3|1.52.0');
  });

  it('coerces empty values to "unknown"', () => {
    expect(versionKey('', '')).toBe('unknown|unknown');
    expect(versionKey(null, '1.0.0')).toBe('unknown|1.0.0');
  });
});

describe('loadManifest', () => {
  it('returns default empty manifest when file does not exist', async () => {
    const m = await loadManifest(tmpRoot);
    expect(m).toEqual({ version: 1, entries: {} });
  });

  it('returns default empty manifest when file is corrupted', async () => {
    const dir = path.join(tmpRoot, 'lightpanda');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'capabilities.json'), 'not json');
    const m = await loadManifest(tmpRoot);
    expect(m).toEqual({ version: 1, entries: {} });
  });
});

describe('saveManifest + loadManifest roundtrip', () => {
  it('writes atomically and reads back', async () => {
    const m = {
      version: 1,
      entries: {
        '1.0|1.52': {
          recordedAt: '2026-04-07T00:00:00.000Z',
          knownBroken: [
            {
              signature: 'sha256:abc',
              opKind: 'click',
              errorFingerprint: 'boom',
              observedCount: 2,
              lastSeen: '2026-04-07T00:00:00.000Z',
              fallbackSucceededOn: 'chromium',
            },
          ],
        },
      },
    };
    await saveManifest(m, tmpRoot);
    // .tmp must not be left behind
    const dir = path.join(tmpRoot, 'lightpanda');
    const entries = fs.readdirSync(dir);
    expect(entries).toContain('capabilities.json');
    expect(entries.find((e) => e.endsWith('.tmp'))).toBeUndefined();
    const out = await loadManifest(tmpRoot);
    expect(out).toEqual(m);
  });
});

describe('isKnownBroken', () => {
  it('returns null on miss', async () => {
    expect(await isKnownBroken('1|1', 'sha256:nope', tmpRoot)).toBeNull();
  });

  it('returns the matching entry on hit', async () => {
    await recordBroken(
      '1|1',
      { signature: 'sha256:hit', opKind: 'click', errorFingerprint: 'x' },
      tmpRoot,
    );
    const hit = await isKnownBroken('1|1', 'sha256:hit', tmpRoot);
    expect(hit).toBeTruthy();
    expect(hit.signature).toBe('sha256:hit');
    expect(hit.observedCount).toBe(1);
  });
});

describe('recordBroken', () => {
  it('inserts a new row with observedCount=1', async () => {
    const row = await recordBroken(
      'k1',
      { signature: 'sha256:a', opKind: 'goto', errorFingerprint: 'fp' },
      tmpRoot,
    );
    expect(row.observedCount).toBe(1);
    expect(row.opKind).toBe('goto');
    expect(row.errorFingerprint).toBe('fp');
  });

  it('bumps observedCount + lastSeen on duplicate signature', async () => {
    await recordBroken(
      'k1',
      { signature: 'sha256:a', opKind: 'goto' },
      tmpRoot,
    );
    // small delay so lastSeen can differ
    await new Promise((r) => setTimeout(r, 5));
    const row = await recordBroken(
      'k1',
      { signature: 'sha256:a', opKind: 'goto', fallbackSucceededOn: 'chromium' },
      tmpRoot,
    );
    expect(row.observedCount).toBe(2);
    expect(row.fallbackSucceededOn).toBe('chromium');
  });
});

describe('pruneOldVersionKeys', () => {
  it('keeps the N newest by recordedAt', async () => {
    // Build 4 entries with explicit recordedAt timestamps.
    const m = {
      version: 1,
      entries: {
        old1: { recordedAt: '2020-01-01T00:00:00.000Z', knownBroken: [] },
        old2: { recordedAt: '2021-01-01T00:00:00.000Z', knownBroken: [] },
        new1: { recordedAt: '2025-01-01T00:00:00.000Z', knownBroken: [] },
        new2: { recordedAt: '2026-01-01T00:00:00.000Z', knownBroken: [] },
      },
    };
    await saveManifest(m, tmpRoot);
    const removed = await pruneOldVersionKeys(2, tmpRoot);
    expect(removed.sort()).toEqual(['old1', 'old2']);
    const after = await loadManifest(tmpRoot);
    expect(Object.keys(after.entries).sort()).toEqual(['new1', 'new2']);
  });

  it('does nothing when count <= keep', async () => {
    await recordBroken('only', { signature: 'sha256:x', opKind: 'click' }, tmpRoot);
    const removed = await pruneOldVersionKeys(5, tmpRoot);
    expect(removed).toEqual([]);
  });
});

describe('fingerprintError', () => {
  it('keeps only the first line', () => {
    expect(fingerprintError(new Error('boom\nstack frame'))).toBe('boom');
  });

  it('strips URLs', () => {
    expect(fingerprintError({ message: 'failed to fetch https://x.test/y/z' }))
      .toBe('failed to fetch <URL>');
  });

  it('strips long hex IDs', () => {
    expect(fingerprintError({ message: 'session abcdef0123456789 closed' }))
      .toBe('session <ID> closed');
  });

  it('strips numbers', () => {
    expect(fingerprintError({ message: 'timeout after 5000 ms' }))
      .toBe('timeout after <N> ms');
  });

  it('clamps to 200 chars', () => {
    const long = 'x'.repeat(500);
    expect(fingerprintError({ message: long }).length).toBe(200);
  });

  it('handles raw strings and undefined', () => {
    expect(fingerprintError('plain message')).toBe('plain message');
    expect(fingerprintError(undefined)).toBe('');
  });
});

describe('detectPlaywrightVersion', () => {
  it('reads playwright version from project package.json', () => {
    const v = detectPlaywrightVersion();
    // Memoized — must be a non-empty string. Either a real version
    // or 'unknown' if the walk failed.
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
    // In this repo playwright IS pinned, so we expect a semver-ish value.
    expect(v).not.toBe('unknown');
  });
});
