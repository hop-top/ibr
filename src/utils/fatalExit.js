/**
 * Fatal-exit helper (T-0109).
 *
 * The silent-exit defect: every error path in the CLI did an async
 * logger.error() plus a raw process.stderr.write(), then immediately called
 * process.exit(1). Node's process.exit() does NOT wait for stdout/stderr to
 * drain when they are pipes (the headless / n8n capture case): un-drained
 * bytes are discarded. Winston's File transports are async on top of that.
 * Result: a 0-byte exit with a non-zero code and no error text — the user
 * sees nothing.
 *
 * fatalExit() guarantees the error is written to stderr at ERROR level and
 * that stdio is flushed BEFORE the process exits, so a launch/acquire failure
 * always surfaces an actionable message and a correct exit code.
 */

import { serializeCliError } from './cliErrors.js';

/**
 * Resolve once the stream's internal buffer has drained (or after a timeout,
 * so this can never hang the process). Best-effort — never rejects.
 *
 * @param {NodeJS.WritableStream & { writableLength?: number, once?: Function }} stream
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<void>}
 */
export function flushStream(stream, { timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    try {
      // Nothing buffered → already flushed.
      if (!stream || !stream.writableLength || stream.writableLength === 0) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      stream.once('drain', () => {
        clearTimeout(timer);
        done();
      });
    } catch {
      resolve();
    }
  });
}

/**
 * Flush a winston logger's transports. Best-effort with a timeout so a stuck
 * transport can never wedge the exit. Does NOT end the logger (callers may
 * still want it usable) — it waits for queued writes to settle by racing a
 * short timer.
 *
 * @param {object} logger
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<void>}
 */
export function flushLogger(logger, { timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    try {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      // winston emits 'finish' after all transports flush on end(). But we
      // don't want to end() the shared logger; instead give the event loop a
      // couple of ticks for the transports' async writes, bounded by the
      // timer. setImmediate lets already-queued transport I/O run.
      setImmediate(() => {
        setImmediate(() => {
          clearTimeout(timer);
          done();
        });
      });
    } catch {
      resolve();
    }
  });
}

/**
 * Log a fatal error, write a structured error to stderr, flush stdio, then
 * exit with a non-zero code. Never throws — a broken logger must not turn a
 * clean failure into a crash, and must still exit non-zero.
 *
 * @param {object} logger  a winston-like logger with .error()
 * @param {Error & { code?: string, message?: string }} error
 * @param {object} [opts]
 * @param {string} [opts.code]     structured error code (default RUNTIME_ERROR)
 * @param {string} [opts.message]  extra human-facing guidance logged at error level
 * @param {number} [opts.exitCode] process exit code (default 1)
 * @param {object} [opts.meta]     extra structured meta for logger.error
 * @returns {Promise<void>}
 */
export async function fatalExit(logger, error, opts = {}) {
  const { code = 'RUNTIME_ERROR', message, exitCode = 1, meta } = opts;
  const payload = serializeCliError({
    code: error?.code || code,
    message: error?.message || 'Unknown error',
    step: error?.step,
    action: error?.action,
  });

  // 1. Log at ERROR level — visible even at info-level filtering.
  try {
    logger.error(message || error?.message || 'Fatal error', {
      error: error?.message,
      code: payload.error.code,
      ...(meta || {}),
    });
  } catch {
    // A broken logger must not prevent the error from surfacing.
  }

  // 2. Always write the structured error straight to stderr (independent of
  //    the logger) so there is ALWAYS non-empty output on a failure.
  try {
    process.stderr.write(`\n${JSON.stringify(payload)}\n`);
  } catch {
    // stderr itself is unusable — nothing more we can do.
  }

  // 3. Flush stdio + logger transports BEFORE exiting so piped/backpressured
  //    output is not truncated by process.exit().
  try {
    await Promise.all([
      flushStream(process.stderr),
      flushStream(process.stdout),
      flushLogger(logger),
    ]);
  } catch {
    // flush is best-effort; never block the exit on it.
  }

  process.exit(exitCode);
}
