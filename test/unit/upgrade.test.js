/**
 * Unit tests for src/upgrade.js
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createUpgrader, isNewer, checkForUpdate as _checkForUpdate } from '@hop/upgrade';

const _up = createUpgrader({ binary: 'idx', githubRepo: 'hop-top/idx' });
const { isSnoozed, snooze } = _up;
const checkForUpdate = (current, opts) => _checkForUpdate('idx', current, opts);

// Isolate state dir per test
const tmpDir = path.join(os.tmpdir(), `idx-upgrade-test-${process.pid}`);
beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.XDG_STATE_HOME = tmpDir;
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.XDG_STATE_HOME;
});

// ---------------------------------------------------------------------------
// isNewer
// ---------------------------------------------------------------------------
describe('isNewer', () => {
  it('detects patch bump', () => expect(isNewer('1.0.0', '1.0.1')).toBe(true));
  it('no update same', () => expect(isNewer('1.0.0', '1.0.0')).toBe(false));
  it('no update older', () => expect(isNewer('1.0.1', '1.0.0')).toBe(false));
  it('release > pre-release', () => expect(isNewer('1.0.0-alpha.1', '1.0.0')).toBe(true));
  it('pre-release < release', () => expect(isNewer('1.0.0', '1.0.0-alpha.1')).toBe(false));
  it('alpha.2 > alpha.1', () => expect(isNewer('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(true));
  it('handles v prefix', () => expect(isNewer('v1.0.0', 'v1.0.1')).toBe(true));
  it('empty returns false', () => expect(isNewer('', '1.0.0')).toBe(false));
});

// ---------------------------------------------------------------------------
// snooze / isSnoozed
// ---------------------------------------------------------------------------
describe('snooze', () => {
  it('not snoozed initially', () => expect(isSnoozed()).toBe(false));

  it('is snoozed after snooze()', () => {
    snooze(60_000);
    expect(isSnoozed()).toBe(true);
  });

  it('not snoozed after expiry', () => {
    snooze(-1000); // already expired
    expect(isSnoozed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — mock fetch
// ---------------------------------------------------------------------------
describe('checkForUpdate', () => {
  it('detects update from custom URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.0.0', url: 'http://example.com/idx', notes: 'Great' }),
    });

    const r = await checkForUpdate('1.0.0', { releaseUrl: 'http://fake/release' });
    expect(r.updateAvail).toBe(true);
    expect(r.latest).toBe('2.0.0');
  });

  it('no update when same version', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0', url: 'http://example.com/idx' }),
    });

    const r = await checkForUpdate('1.0.0', { releaseUrl: 'http://fake/release' });
    expect(r.updateAvail).toBe(false);
  });

  it('uses cache on second call', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({ version: '2.0.0', url: 'http://example.com/idx' }),
      };
    });

    await checkForUpdate('1.0.0', { releaseUrl: 'http://fake/release' });
    await checkForUpdate('1.0.0', { releaseUrl: 'http://fake/release' });
    expect(calls).toBe(1);
  });
});
