import logger from './utils/logger.js';

const MAX_MESSAGE_LENGTH = 512;
const RAPID_FIRE_THRESHOLD_MS = 100;

/**
 * Manages browser dialogs (alert, confirm, prompt, beforeunload).
 * Maintains a circular buffer of dialog events for observability.
 */
export class DialogManager {
    /**
     * @param {import('playwright').Page} page
     * @param {Object} config
     * @param {boolean} [config.autoAccept=true]
     * @param {string}  [config.defaultPromptText='']
     * @param {number}  [config.bufferCapacity=50000]
     */
    constructor(page, config = {}) {
        this.page = page;
        this.autoAccept = config.autoAccept ?? true;
        this.defaultPromptText = config.defaultPromptText ?? '';
        this.bufferCapacity = config.bufferCapacity ?? 50000;

        /** @type {Array<Object>} circular buffer entries */
        this._buffer = [];
        this._dropped = 0;
        this._handler = null;
    }

    /**
     * Attach dialog listener to page.
     * Safe to call multiple times; re-registers handler each call
     * (matches Operations pattern of re-attaching per task).
     */
    async init() {
        // Remove any previously registered handler to avoid duplicates
        if (this._handler && this.page?.off) {
            this.page.off('dialog', this._handler);
        }

        this._handler = (dialog) => this._handleDialog(dialog);

        if (this.page?.on) {
            this.page.on('dialog', this._handler);
        }
    }

    /** @returns {Array<Object>} full buffer (oldest → newest) */
    getBuffer() {
        return this._buffer.slice();
    }

    /**
     * @param {number} n
     * @returns {Array<Object>} last N entries
     */
    getRecentDialogs(n) {
        return this._buffer.slice(-n);
    }

    /** Flush buffer — call at task start. */
    clear() {
        this._buffer = [];
        this._dropped = 0;
    }

    // ─── private ────────────────────────────────────────────────────────────

    /**
     * Playwright dialog event handler.
     * @param {import('playwright').Dialog} dialog
     */
    async _handleDialog(dialog) {
        const timestamp = Date.now();
        const rawMessage = dialog.message() ?? '';
        const truncated = rawMessage.length > MAX_MESSAGE_LENGTH;
        const message = truncated ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) : rawMessage;

        if (truncated) {
            logger.warn('Dialog message truncated', {
                originalLength: rawMessage.length,
                cap: MAX_MESSAGE_LENGTH,
                type: dialog.type(),
            });
        }

        // Rapid-fire detection
        if (this._buffer.length > 0) {
            const prev = this._buffer[this._buffer.length - 1];
            const delta = timestamp - prev.timestamp;
            if (delta < RAPID_FIRE_THRESHOLD_MS) {
                logger.info('Rapid-fire dialog detected', { deltaMs: delta, type: dialog.type() });
            }
        }

        const entry = {
            timestamp,
            type: dialog.type(),
            message,
            ...(dialog.type() === 'prompt' ? { defaultValue: dialog.defaultValue() } : {}),
        };

        logger.info('Dialog detected', {
            type: entry.type,
            messagePreview: message.slice(0, 80),
        });

        if (this.autoAccept) {
            try {
                if (entry.type === 'prompt') {
                    await dialog.accept(this.defaultPromptText);
                    entry.response = this.defaultPromptText;
                } else {
                    await dialog.accept();
                }
                entry.action = 'accepted';
                logger.info('Dialog accepted', { type: entry.type });
            } catch (err) {
                logger.debug('Dialog auto-accept failed (likely dismissed by navigation)', {
                    type: entry.type,
                    error: err.message,
                });
                entry.action = 'accept-failed';
            }
        } else {
            try {
                await dialog.dismiss();
                entry.action = 'dismissed';
                logger.info('Dialog dismissed', { type: entry.type });
            } catch (err) {
                logger.debug('Dialog dismiss failed (likely dismissed by navigation)', {
                    type: entry.type,
                    error: err.message,
                });
                entry.action = 'dismiss-failed';
            }
        }

        this._pushEntry(entry);
    }

    /**
     * Push entry into circular buffer, dropping oldest on overflow.
     * @param {Object} entry
     */
    _pushEntry(entry) {
        if (this._buffer.length >= this.bufferCapacity) {
            this._buffer.shift();
            this._dropped++;
            if (this._dropped === 1 || this._dropped % 1000 === 0) {
                logger.warn('Dialog buffer overflow; dropping oldest entries', {
                    dropped: this._dropped,
                    capacity: this.bufferCapacity,
                });
            }
        }
        this._buffer.push(entry);
    }
}
