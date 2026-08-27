/**
 * Tests for fatalExit.js (T-0109).
 *
 * The silent-exit defect: every error path in src/index.js did an async
 * logger.error() + a raw process.stderr.write() immediately followed by
 * process.exit(1). On a piped/backpressured stderr (headless / n8n capture),
 * process.exit() truncates un-drained writes → a 0-byte exit with a non-zero
 * code and NO error text. fatalExit() guarantees the error surfaces on stderr
 * and stdio is flushed BEFORE the process exits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fatalExit, flushStream } from '../../../src/utils/fatalExit.js';

let stderrSpy;
let exitSpy;

function makeLogger() {
  return { error: vi.fn() };
}

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // Never actually terminate the test runner.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
});

afterEach(() => {
  stderrSpy.mockRestore();
  exitSpy.mockRestore();
});

describe('fatalExit', () => {
  it('writes a NON-empty error to stderr (never a 0-byte exit)', async () => {
    const logger = makeLogger();
    await fatalExit(logger, new Error('launch failed: pinned build missing'), {
      code: 'RUNTIME_ERROR',
    });

    // logger.error was called at ERROR level (not debug).
    expect(logger.error).toHaveBeenCalled();
    // Something was written to stderr — a non-empty structured payload.
    const bytes = stderrSpy.mock.calls
      .map((c) => c[0])
      .filter((s) => typeof s === 'string')
      .join('');
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes).toMatch(/RUNTIME_ERROR/);
  });

  it('exits with a non-zero code', async () => {
    await fatalExit(makeLogger(), new Error('boom'), { code: 'RUNTIME_ERROR' });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('flushes stdio BEFORE calling process.exit (no swallowed output)', async () => {
    const order = [];
    // Record the moment stderr is written vs the moment exit is called.
    stderrSpy.mockImplementation(() => {
      order.push('write');
      return true;
    });
    exitSpy.mockImplementation(() => {
      order.push('exit');
    });

    await fatalExit(makeLogger(), new Error('boom'), { code: 'RUNTIME_ERROR' });

    const firstWrite = order.indexOf('write');
    const exitAt = order.indexOf('exit');
    expect(firstWrite).toBeGreaterThanOrEqual(0);
    expect(exitAt).toBeGreaterThan(firstWrite);
  });

  it('does not throw when the logger itself throws', async () => {
    const logger = { error: () => { throw new Error('winston blew up'); } };
    await expect(
      fatalExit(logger, new Error('boom'), { code: 'RUNTIME_ERROR' }),
    ).resolves.toBeUndefined();
    // Even with a broken logger, we still exit non-zero.
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('flushStream', () => {
  it('resolves immediately when the stream buffer is already empty', async () => {
    const stream = { writableLength: 0, once: vi.fn(), write: vi.fn() };
    await expect(flushStream(stream)).resolves.toBeUndefined();
    // No drain listener needed when nothing is buffered.
    expect(stream.once).not.toHaveBeenCalled();
  });

  it('waits for the drain event when the buffer is backpressured', async () => {
    let drainCb;
    const stream = {
      writableLength: 1024,
      once: vi.fn((evt, cb) => {
        if (evt === 'drain') drainCb = cb;
      }),
    };
    const p = flushStream(stream, { timeoutMs: 1000 });
    expect(stream.once).toHaveBeenCalledWith('drain', expect.any(Function));
    // Simulate the kernel draining the pipe.
    drainCb();
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves on timeout so it can never hang the process', async () => {
    const stream = { writableLength: 4096, once: vi.fn() };
    // Tiny timeout; never fire drain.
    await expect(flushStream(stream, { timeoutMs: 5 })).resolves.toBeUndefined();
  });
});
