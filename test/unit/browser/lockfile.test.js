import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

import { withLock } from '../../../src/browser/lockfile.js';

let dir;
let lockPath;

beforeEach(async () => {
  dir = path.join(os.tmpdir(), `ibr-lockfile-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  lockPath = path.join(dir, 'test.lock');
});

afterEach(async () => {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('withLock', () => {
  it('happy path: runs fn and returns its value', async () => {
    const result = await withLock(lockPath, async () => 42);
    expect(result).toBe(42);
    // Lock file should be cleaned up
    expect(fsSync.existsSync(lockPath)).toBe(false);
  });

  it('writes pid + ISO timestamp to lock file', async () => {
    let observed;
    await withLock(lockPath, async () => {
      observed = await fs.readFile(lockPath, 'utf8');
    });
    expect(observed).toContain(String(process.pid));
    expect(observed).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('cleans up on fn error', async () => {
    await expect(
      withLock(lockPath, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(fsSync.existsSync(lockPath)).toBe(false);
  });

  it('concurrent calls queue (mutual exclusion)', async () => {
    const order = [];
    const t1 = withLock(lockPath, async () => {
      order.push('t1-start');
      await new Promise((r) => setTimeout(r, 150));
      order.push('t1-end');
      return 1;
    });
    // Stagger so t2 sees the lock
    await new Promise((r) => setTimeout(r, 20));
    const t2 = withLock(lockPath, async () => {
      order.push('t2-start');
      order.push('t2-end');
      return 2;
    });
    const [r1, r2] = await Promise.all([t1, t2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual(['t1-start', 't1-end', 't2-start', 't2-end']);
  });

  it('removes stale lock and retries', async () => {
    // Pre-create a stale lock (mtime far in past).
    await fs.writeFile(lockPath, '999\n2020-01-01T00:00:00.000Z\n');
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(lockPath, past, past);

    const result = await withLock(lockPath, async () => 'ok', { staleMs: 60_000 });
    expect(result).toBe('ok');
  });

  it('throws on timeout when held', async () => {
    const slow = withLock(lockPath, async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      withLock(lockPath, async () => 'never', { timeoutMs: 100, staleMs: 60_000_000 }),
    ).rejects.toThrow(/timeout/);
    await slow;
  });
});
