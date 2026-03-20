/**
 * Unit tests for DialogManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/logger.js');

import { DialogManager } from '../../src/DialogManager.js';

// ── helpers ────────────────────────────────────────────────────────────────────

function makePage() {
    const listeners = {};
    return {
        on: vi.fn((event, handler) => { listeners[event] = handler; }),
        off: vi.fn(),
        _emit: (event, ...args) => listeners[event]?.(...args),
    };
}

function makeDialog({ type = 'alert', message = 'hello', defaultValue = '' } = {}) {
    return {
        type: vi.fn().mockReturnValue(type),
        message: vi.fn().mockReturnValue(message),
        defaultValue: vi.fn().mockReturnValue(defaultValue),
        accept: vi.fn().mockResolvedValue(undefined),
        dismiss: vi.fn().mockResolvedValue(undefined),
    };
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('DialogManager', () => {

    describe('init()', () => {
        it('attaches dialog listener to page', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();
            expect(page.on).toHaveBeenCalledWith('dialog', expect.any(Function));
        });

        it('removes old listener before re-attaching', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();
            const firstHandler = page.on.mock.calls[0][1];
            await dm.init();
            expect(page.off).toHaveBeenCalledWith('dialog', firstHandler);
        });
    });

    describe('auto-accept (autoAccept=true)', () => {
        it('calls dialog.accept()', async () => {
            const page = makePage();
            const dm = new DialogManager(page, { autoAccept: true });
            await dm.init();

            const dialog = makeDialog({ type: 'alert', message: 'hi' });
            await page._emit('dialog', dialog);

            expect(dialog.accept).toHaveBeenCalled();
            expect(dialog.dismiss).not.toHaveBeenCalled();
        });

        it('entry has action="accepted"', async () => {
            const page = makePage();
            const dm = new DialogManager(page, { autoAccept: true });
            await dm.init();

            await page._emit('dialog', makeDialog({ type: 'confirm', message: 'ok?' }));

            const buf = dm.getBuffer();
            expect(buf).toHaveLength(1);
            expect(buf[0].action).toBe('accepted');
        });
    });

    describe('auto-dismiss (autoAccept=false)', () => {
        it('calls dialog.dismiss()', async () => {
            const page = makePage();
            const dm = new DialogManager(page, { autoAccept: false });
            await dm.init();

            const dialog = makeDialog({ type: 'confirm', message: 'sure?' });
            await page._emit('dialog', dialog);

            expect(dialog.dismiss).toHaveBeenCalled();
            expect(dialog.accept).not.toHaveBeenCalled();
        });

        it('entry has action="dismissed"', async () => {
            const page = makePage();
            const dm = new DialogManager(page, { autoAccept: false });
            await dm.init();

            await page._emit('dialog', makeDialog({ type: 'confirm', message: 'sure?' }));

            const buf = dm.getBuffer();
            expect(buf[0].action).toBe('dismissed');
        });
    });

    describe('buffer entry shape', () => {
        it('has {timestamp, type, message, action}', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();

            const before = Date.now();
            await page._emit('dialog', makeDialog({ type: 'alert', message: 'test' }));
            const after = Date.now();

            const entry = dm.getBuffer()[0];
            expect(entry.timestamp).toBeGreaterThanOrEqual(before);
            expect(entry.timestamp).toBeLessThanOrEqual(after);
            expect(entry.type).toBe('alert');
            expect(entry.message).toBe('test');
            expect(entry.action).toBe('accepted');
        });

        it('prompt entry includes defaultValue', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();

            await page._emit('dialog', makeDialog({ type: 'prompt', message: 'name?', defaultValue: 'Jane' }));

            const entry = dm.getBuffer()[0];
            expect(entry.defaultValue).toBe('Jane');
        });
    });

    describe('getBuffer()', () => {
        it('returns all entries', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();

            await page._emit('dialog', makeDialog({ message: 'a' }));
            await page._emit('dialog', makeDialog({ message: 'b' }));
            await page._emit('dialog', makeDialog({ message: 'c' }));

            expect(dm.getBuffer()).toHaveLength(3);
        });

        it('returns a copy, not the internal ref', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();
            await page._emit('dialog', makeDialog());
            const buf = dm.getBuffer();
            buf.push('extra');
            expect(dm.getBuffer()).toHaveLength(1);
        });
    });

    describe('getRecentDialogs(n)', () => {
        it('returns last N entries', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();

            await page._emit('dialog', makeDialog({ message: 'a' }));
            await page._emit('dialog', makeDialog({ message: 'b' }));
            await page._emit('dialog', makeDialog({ message: 'c' }));

            const recent = dm.getRecentDialogs(2);
            expect(recent).toHaveLength(2);
            expect(recent[0].message).toBe('b');
            expect(recent[1].message).toBe('c');
        });
    });

    describe('clear()', () => {
        it('flushes buffer', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();

            await page._emit('dialog', makeDialog());
            await page._emit('dialog', makeDialog());
            expect(dm.getBuffer()).toHaveLength(2);

            dm.clear();
            expect(dm.getBuffer()).toHaveLength(0);
        });
    });

    describe('message truncation', () => {
        it('truncates message at 512 chars', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();

            const longMsg = 'x'.repeat(600);
            await page._emit('dialog', makeDialog({ message: longMsg }));

            const entry = dm.getBuffer()[0];
            expect(entry.message).toHaveLength(512);
        });

        it('does not truncate message ≤512 chars', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();

            const msg = 'y'.repeat(512);
            await page._emit('dialog', makeDialog({ message: msg }));

            expect(dm.getBuffer()[0].message).toHaveLength(512);
        });
    });

    describe('circular buffer overflow', () => {
        it('drops oldest entry on overflow (capacity=3)', async () => {
            const page = makePage();
            const dm = new DialogManager(page, { bufferCapacity: 3 });
            await dm.init();

            await page._emit('dialog', makeDialog({ message: 'first' }));
            await page._emit('dialog', makeDialog({ message: 'second' }));
            await page._emit('dialog', makeDialog({ message: 'third' }));
            await page._emit('dialog', makeDialog({ message: 'fourth' }));

            const buf = dm.getBuffer();
            expect(buf).toHaveLength(3);
            expect(buf[0].message).toBe('second');
            expect(buf[2].message).toBe('fourth');
        });
    });

    describe('rapid-fire detection', () => {
        it('logs rapid-fire but still records entry when dialogs arrive <100ms apart', async () => {
            const page = makePage();
            const dm = new DialogManager(page);
            await dm.init();

            // Emit two dialogs back-to-back; timestamps will be within same ms
            await page._emit('dialog', makeDialog({ message: 'first' }));
            await page._emit('dialog', makeDialog({ message: 'second' }));

            // Both entries must still be buffered
            const buf = dm.getBuffer();
            expect(buf).toHaveLength(2);
            expect(buf[1].message).toBe('second');
        });
    });

    describe('navigation-dismissed dialog (accept throws)', () => {
        it('swallows error and sets action="accept-failed", does not rethrow', async () => {
            const page = makePage();
            const dm = new DialogManager(page, { autoAccept: true });
            await dm.init();

            const dialog = makeDialog({ type: 'alert', message: 'bye' });
            dialog.accept.mockRejectedValue(new Error('Target closed'));

            // Must not throw
            await expect(page._emit('dialog', dialog)).resolves.not.toThrow();

            const entry = dm.getBuffer()[0];
            expect(entry.action).toBe('accept-failed');
        });
    });

    describe('beforeunload handling', () => {
        it('accepts with no args regardless of defaultPromptText', async () => {
            const page = makePage();
            const dm = new DialogManager(page, { autoAccept: true, defaultPromptText: 'custom' });
            await dm.init();

            const dialog = makeDialog({ type: 'beforeunload', message: '' });
            await page._emit('dialog', dialog);

            expect(dialog.accept).toHaveBeenCalledWith();
            const entry = dm.getBuffer()[0];
            expect(entry.action).toBe('accepted');
        });
    });

});
