/**
 * ContextPool — isolated BrowserContext pool for multi-client daemon.
 *
 * Each checkout allocates a fresh BrowserContext + Page + Operations so
 * clients never share cookies, localStorage or page state.
 * Checkin closes the context and wakes the next queued waiter.
 *
 * Config env vars:
 *   IBR_DAEMON_MAX_CLIENTS      — max concurrent slots (default: 3)
 *   IBR_DAEMON_QUEUE_TIMEOUT_MS — per-waiter queue timeout in ms (default: 30000)
 */

import { Operations } from '../Operations.js';
import { createAIProvider } from '../ai/provider.js';
import logger from '../utils/logger.js';

export const DEFAULT_MAX_CLIENTS = 3;
export const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;

export class ContextPool {
  /**
   * @param {import('playwright').Browser} browser
   * @param {Object} opts
   * @param {number}  [opts.maxClients]
   * @param {number}  [opts.queueTimeoutMs]
   * @param {Object}  [opts.operationOptions]  — passed to each new Operations
   * @param {Function} [opts.aiProviderFactory] — () => aiProvider; default createAIProvider
   */
  constructor(browser, opts = {}) {
    this._browser = browser;
    this._maxClients = opts.maxClients ?? DEFAULT_MAX_CLIENTS;
    this._queueTimeoutMs = opts.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
    this._operationOptions = opts.operationOptions ?? {};
    this._aiProviderFactory = opts.aiProviderFactory ?? createAIProvider;

    /** @type {number} active checkouts */
    this._active = 0;

    /** @type {Array<{resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
    this._queue = [];

    logger.debug('ContextPool created', {
      maxClients: this._maxClients,
      queueTimeoutMs: this._queueTimeoutMs,
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Checkout a slot. Blocks (enqueues) if at capacity.
   * Resolves with a slot object that must be returned via checkin().
   *
   * @returns {Promise<{context: import('playwright').BrowserContext,
   *                    page: import('playwright').Page,
   *                    ops: Operations}>}
   */
  async checkout() {
    if (this._active < this._maxClients) {
      return this._allocate();
    }

    // At capacity — enqueue
    return new Promise((resolve, reject) => {
      let timer;
      const entry = { resolve, reject, timer: null };

      timer = setTimeout(() => {
        const idx = this._queue.indexOf(entry);
        if (idx !== -1) this._queue.splice(idx, 1);
        reject(new Error(
          `ContextPool: queue timeout after ${this._queueTimeoutMs}ms. ` +
          `All ${this._maxClients} slots busy. ` +
          `Increase IBR_DAEMON_MAX_CLIENTS or retry later.`
        ));
      }, this._queueTimeoutMs);

      entry.timer = timer;
      this._queue.push(entry);
      logger.debug('ContextPool: request queued', { queueDepth: this._queue.length });
    });
  }

  /**
   * Return a slot. Always call in a finally block.
   * Closes the context and either wakes the next waiter or decrements active count.
   *
   * @param {{context: import('playwright').BrowserContext}} slot
   */
  async checkin(slot) {
    // Close context (also closes its pages)
    if (slot?.context) {
      try {
        await slot.context.close();
      } catch (err) {
        logger.warn('ContextPool: error closing context on checkin', { error: err.message });
      }
    }

    const next = this._queue.shift();
    if (next) {
      clearTimeout(next.timer);
      // Allocate fresh slot for the waiter
      this._allocate()
        .then(next.resolve)
        .catch(next.reject);
    } else {
      this._active--;
    }
  }

  /**
   * Graceful drain — close all active slots.
   * Rejects all queued waiters.
   */
  async drain() {
    // Reject all pending waiters
    for (const entry of this._queue) {
      clearTimeout(entry.timer);
      entry.reject(new Error('ContextPool: daemon shutting down'));
    }
    this._queue.length = 0;
    logger.debug('ContextPool drained', { active: this._active });
  }

  get activeCount() { return this._active; }
  get queueDepth() { return this._queue.length; }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Allocate a new BrowserContext + Page + Operations slot.
   * Increments active count before any async work so callers can rely on
   * maxClients enforcement even if allocate is called concurrently.
   */
  async _allocate() {
    this._active++;
    try {
      const context = await this._browser.newContext();
      const page = await context.newPage();
      const aiProvider = this._aiProviderFactory();
      const ops = new Operations({ aiProvider, page }, this._operationOptions);
      logger.debug('ContextPool: slot allocated', { active: this._active });
      return { context, page, ops };
    } catch (err) {
      // Allocation failed — release the count
      this._active--;
      throw err;
    }
  }
}
