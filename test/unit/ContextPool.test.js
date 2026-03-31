/**
 * Unit tests for src/server/ContextPool.js
 *
 * Covers:
 *  - basic checkout/checkin cycle
 *  - N concurrent checkouts fill pool
 *  - (N+1)th request queues and resolves after checkin
 *  - queue timeout fires when no slot freed in time
 *  - drain() rejects all queued waiters
 *  - isolation: each slot gets its own context/page/ops objects
 *  - maxClients=1 behaves like original single-client model
 *  - allocation failure decrements active count
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextPool, DEFAULT_MAX_CLIENTS, DEFAULT_QUEUE_TIMEOUT_MS } from '../../src/server/ContextPool.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makePage() {
  return { on: vi.fn(), off: vi.fn(), id: Math.random() };
}

function makeContext(page) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page ?? makePage()),
    id: Math.random(),
  };
}

function makeBrowser(contextFactory) {
  return {
    newContext: vi.fn().mockImplementation(() =>
      Promise.resolve(contextFactory ? contextFactory() : makeContext())
    ),
  };
}

// Minimal Operations stub — real class wires Playwright events; skip that here
vi.mock('../../src/Operations.js', () => ({
  Operations: vi.fn().mockImplementation(() => ({
    extracts: [],
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    executionIndex: 0,
    parseTaskDescription: vi.fn(),
    executeTask: vi.fn(),
  })),
}));

vi.mock('../../src/ai/provider.js', () => ({
  createAIProvider: vi.fn().mockReturnValue({ provider: 'mock', model: 'mock' }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePool(opts = {}) {
  return new ContextPool(makeBrowser(), {
    maxClients: 2,
    queueTimeoutMs: 50, // short timeout for tests
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContextPool — constants', () => {
  it('exports DEFAULT_MAX_CLIENTS = 3', () => {
    expect(DEFAULT_MAX_CLIENTS).toBe(3);
  });

  it('exports DEFAULT_QUEUE_TIMEOUT_MS = 30000', () => {
    expect(DEFAULT_QUEUE_TIMEOUT_MS).toBe(30_000);
  });
});

describe('ContextPool — basic lifecycle', () => {
  it('checkout returns a slot with context, page, ops', async () => {
    const pool = makePool({ maxClients: 1 });
    const slot = await pool.checkout();

    expect(slot).toHaveProperty('context');
    expect(slot).toHaveProperty('page');
    expect(slot).toHaveProperty('ops');
    expect(pool.activeCount).toBe(1);

    await pool.checkin(slot);
    expect(pool.activeCount).toBe(0);
  });

  it('checkin closes the context', async () => {
    const pool = makePool({ maxClients: 1 });
    const slot = await pool.checkout();

    await pool.checkin(slot);

    expect(slot.context.close).toHaveBeenCalledOnce();
  });

  it('active count tracks in-flight slots', async () => {
    const pool = makePool({ maxClients: 3 });

    const s1 = await pool.checkout();
    const s2 = await pool.checkout();
    expect(pool.activeCount).toBe(2);

    await pool.checkin(s1);
    expect(pool.activeCount).toBe(1);

    await pool.checkin(s2);
    expect(pool.activeCount).toBe(0);
  });
});

describe('ContextPool — isolation', () => {
  it('each slot has distinct context + page + ops instances', async () => {
    const pool = makePool({ maxClients: 2 });

    const s1 = await pool.checkout();
    const s2 = await pool.checkout();

    // Different context objects
    expect(s1.context).not.toBe(s2.context);
    // Different ops objects
    expect(s1.ops).not.toBe(s2.ops);

    await pool.checkin(s1);
    await pool.checkin(s2);
  });
});

describe('ContextPool — queueing', () => {
  it('(N+1)th checkout queues until a slot is freed', async () => {
    const pool = makePool({ maxClients: 2, queueTimeoutMs: 1_000 });

    const s1 = await pool.checkout();
    const s2 = await pool.checkout();

    // At capacity — third must queue
    let resolved = false;
    const p3 = pool.checkout().then(s => { resolved = true; return s; });

    // Not yet resolved
    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(false);
    expect(pool.queueDepth).toBe(1);

    // Free a slot → queued waiter resolves
    await pool.checkin(s1);

    const s3 = await p3;
    expect(resolved).toBe(true);
    expect(s3).toHaveProperty('context');

    await pool.checkin(s2);
    await pool.checkin(s3);
  });

  it('queue depth is reported correctly', async () => {
    const pool = makePool({ maxClients: 1, queueTimeoutMs: 1_000 });

    const s1 = await pool.checkout();
    // Queue two more
    const p2 = pool.checkout();
    const p3 = pool.checkout();

    await new Promise(r => setTimeout(r, 10));
    expect(pool.queueDepth).toBe(2);

    await pool.checkin(s1);
    const s2 = await p2;

    await pool.checkin(s2);
    const s3 = await p3;

    await pool.checkin(s3);
    expect(pool.queueDepth).toBe(0);
  });

  it('queue timeout rejects waiter when no slot freed in time', async () => {
    const pool = makePool({ maxClients: 1, queueTimeoutMs: 30 });

    const s1 = await pool.checkout();

    // Second checkout will time out
    await expect(pool.checkout()).rejects.toThrow(/queue timeout/i);

    // Clean up
    await pool.checkin(s1);
  });
});

describe('ContextPool — drain', () => {
  it('drain rejects all queued waiters', async () => {
    const pool = makePool({ maxClients: 1, queueTimeoutMs: 5_000 });

    const s1 = await pool.checkout(); // fills slot

    const p2 = pool.checkout();
    const p3 = pool.checkout();

    await new Promise(r => setTimeout(r, 10));
    expect(pool.queueDepth).toBe(2);

    await pool.drain();

    await expect(p2).rejects.toThrow(/shutting down/i);
    await expect(p3).rejects.toThrow(/shutting down/i);
    expect(pool.queueDepth).toBe(0);

    // Clean up active slot
    await pool.checkin(s1);
  });
});

describe('ContextPool — maxClients=1 single-client mode', () => {
  it('behaves serially: second checkout waits for first to complete', async () => {
    const order = [];
    const pool = makePool({ maxClients: 1, queueTimeoutMs: 2_000 });

    const s1 = await pool.checkout();
    order.push('checkout1');

    const p2 = pool.checkout().then(s => { order.push('checkout2'); return s; });

    await new Promise(r => setTimeout(r, 10));
    expect(order).toEqual(['checkout1']); // second hasn't run

    await pool.checkin(s1);
    order.push('checkin1');

    const s2 = await p2;
    await pool.checkin(s2);

    expect(order).toEqual(['checkout1', 'checkin1', 'checkout2']);
  });
});

describe('ContextPool — allocation failure', () => {
  it('decrements active count when newContext throws', async () => {
    const failBrowser = {
      newContext: vi.fn().mockRejectedValue(new Error('browser crashed')),
    };
    const pool = new ContextPool(failBrowser, {
      maxClients: 3,
      queueTimeoutMs: 50,
    });

    await expect(pool.checkout()).rejects.toThrow('browser crashed');
    expect(pool.activeCount).toBe(0); // must be rolled back
  });
});

describe('ContextPool — checkin with null slot', () => {
  it('does not throw when slot is null/undefined', async () => {
    const pool = makePool({ maxClients: 2 });
    // Should not throw — defensive path
    await expect(pool.checkin(null)).resolves.toBeUndefined();
    await expect(pool.checkin(undefined)).resolves.toBeUndefined();
  });
});
