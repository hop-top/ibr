import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressFeedback } from '../../../src/observability/ProgressFeedback.js';

function makeStream() {
    const lines = [];
    return {
        write(chunk) { lines.push(chunk); return true; },
        lines,
        get text() { return lines.join(''); },
    };
}

describe('ProgressFeedback (enabled, non-TTY)', () => {
    let stream;
    let pf;

    beforeEach(() => {
        stream = makeStream();
        pf = new ProgressFeedback({ total: 3, quiet: false, stream, isTTY: false });
    });

    it('is enabled when total > 0 and not quiet', () => {
        expect(pf.enabled).toBe(true);
    });

    it('advance emits once per instruction with correct n/N', () => {
        pf.advance({ name: 'wait', prompt: 'wait for the page to load' });
        pf.advance({ name: 'extract', prompt: 'report PAGE_OK if heading shown' });
        expect(stream.lines).toHaveLength(2);
        // non-TTY renders NDJSON (kit ProgressReporter branch)
        const first = JSON.parse(stream.lines[0].trim());
        expect(first.current).toBe(1);
        expect(first.total).toBe(3);
        expect(first.step).toBe('wait');
        const second = JSON.parse(stream.lines[1].trim());
        expect(second.current).toBe(2);
        expect(second.total).toBe(3);
        expect(second.step).toBe('extract');
    });

    it('percent is computed from current/total', () => {
        pf.advance({ name: 'click', prompt: 'click login' });
        const obj = JSON.parse(stream.lines[0].trim());
        expect(obj.percent).toBe(33);
    });

    it('label is derived from instruction name + short prompt', () => {
        pf.advance({ name: 'click', prompt: 'click the very long login button label that should be truncated for display purposes here' });
        const obj = JSON.parse(stream.lines[0].trim());
        expect(obj.step).toBe('click');
        expect(typeof obj.message).toBe('string');
        // message should carry a short label, not the full prompt untouched
        expect(obj.message.length).toBeLessThan(120);
    });

    it('finish emits a done line', () => {
        pf.advance({ name: 'wait', prompt: 'wait' });
        pf.finish('completed');
        const doneObj = JSON.parse(stream.lines[stream.lines.length - 1].trim());
        expect(doneObj.done).toBe(true);
    });

    it('never advances past total', () => {
        pf.advance({ name: 'a', prompt: 'a' });
        pf.advance({ name: 'b', prompt: 'b' });
        pf.advance({ name: 'c', prompt: 'c' });
        pf.advance({ name: 'd', prompt: 'd' }); // one extra
        const last = JSON.parse(stream.lines[stream.lines.length - 1].trim());
        expect(last.current).toBeLessThanOrEqual(3);
    });
});

describe('ProgressFeedback (TTY)', () => {
    it('renders a human-readable line on TTY with n/N', () => {
        const stream = makeStream();
        const pf = new ProgressFeedback({ total: 2, quiet: false, stream, isTTY: true });
        pf.advance({ name: 'wait', prompt: 'wait for load' });
        expect(stream.text).toContain('1/2');
        // not JSON on TTY
        expect(() => JSON.parse(stream.lines[0].trim())).toThrow();
    });
});

describe('ProgressFeedback (silent)', () => {
    it('emits nothing when quiet', () => {
        const stream = makeStream();
        const pf = new ProgressFeedback({ total: 3, quiet: true, stream, isTTY: true });
        pf.advance({ name: 'wait', prompt: 'wait' });
        pf.finish('done');
        expect(pf.enabled).toBe(false);
        expect(stream.lines).toHaveLength(0);
    });

    it('emits nothing when total is 0', () => {
        const stream = makeStream();
        const pf = new ProgressFeedback({ total: 0, quiet: false, stream, isTTY: false });
        pf.advance({ name: 'wait', prompt: 'wait' });
        expect(pf.enabled).toBe(false);
        expect(stream.lines).toHaveLength(0);
    });
});

describe('ProgressFeedback (stream discipline)', () => {
    it('writes only to the provided (human) stream, never stdout', () => {
        const stream = makeStream();
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        try {
            const pf = new ProgressFeedback({ total: 2, quiet: false, stream, isTTY: false });
            pf.advance({ name: 'wait', prompt: 'wait' });
            pf.advance({ name: 'extract', prompt: 'extract' });
            pf.finish('done');
            expect(stdoutSpy).not.toHaveBeenCalled();
            expect(stream.lines.length).toBeGreaterThan(0);
        } finally {
            stdoutSpy.mockRestore();
        }
    });

    it('does not throw if the stream write throws', () => {
        const badStream = { write() { throw new Error('broken pipe'); } };
        const pf = new ProgressFeedback({ total: 1, quiet: false, stream: badStream, isTTY: false });
        expect(() => pf.advance({ name: 'wait', prompt: 'wait' })).not.toThrow();
        expect(() => pf.finish('done')).not.toThrow();
    });
});
