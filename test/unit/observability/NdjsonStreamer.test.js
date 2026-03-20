import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NdjsonStreamer } from '../../../src/observability/NdjsonStreamer.js';

function makeStream() {
    const lines = [];
    return {
        write(chunk) { lines.push(chunk); },
        lines,
    };
}

function parseLine(line) {
    return JSON.parse(line.trim());
}

describe('NdjsonStreamer (disabled)', () => {
    it('does not emit when disabled', () => {
        const stream = makeStream();
        const s = new NdjsonStreamer(stream, false);
        s.emit({ event: 'test', timestamp: new Date().toISOString() });
        expect(stream.lines).toHaveLength(0);
    });
});

describe('NdjsonStreamer (enabled)', () => {
    let stream;
    let s;

    beforeEach(() => {
        stream = makeStream();
        s = new NdjsonStreamer(stream, true);
    });

    it('emits valid NDJSON line', () => {
        s.emit({ event: 'test', timestamp: '2026-01-01T00:00:00.000Z', foo: 'bar' });
        expect(stream.lines).toHaveLength(1);
        const obj = parseLine(stream.lines[0]);
        expect(obj.event).toBe('test');
        expect(obj.foo).toBe('bar');
        expect(stream.lines[0]).toMatch(/\n$/);
    });

    it('taskStart emits correct event', () => {
        s.taskStart({ prompt: 'https://example.com' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.event).toBe('task_start');
        expect(obj.prompt).toBe('https://example.com');
        expect(obj.timestamp).toMatch(/^\d{4}-/);
    });

    it('taskEnd success emits duration_ms and status', () => {
        const startMs = Date.now() - 100;
        s.taskEnd({ startMs, status: 'success' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.event).toBe('task_end');
        expect(obj.status).toBe('success');
        expect(obj.duration_ms).toBeGreaterThanOrEqual(100);
        expect(obj.error).toBeUndefined();
    });

    it('taskEnd error includes error field', () => {
        s.taskEnd({ startMs: Date.now(), status: 'error', error: 'boom' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.status).toBe('error');
        expect(obj.error).toBe('boom');
    });

    it('navigation success', () => {
        s.navigation({ url: 'https://example.com', status: 'success' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.event).toBe('navigation');
        expect(obj.url).toBe('https://example.com');
        expect(obj.status).toBe('success');
        expect(obj.error).toBeUndefined();
    });

    it('navigation error includes error field', () => {
        s.navigation({ url: 'https://x.com', status: 'error', error: 'net::ERR' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.error).toBe('net::ERR');
    });

    it('action click', () => {
        s.action({ actionType: 'click', selector: 'button#submit', status: 'success' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.event).toBe('click');
        expect(obj.selector).toBe('button#submit');
        expect(obj.status).toBe('success');
    });

    it('action fill includes value', () => {
        s.action({ actionType: 'fill', selector: 'input', value: 'hello', status: 'success' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.event).toBe('fill');
        expect(obj.value).toBe('hello');
    });

    it('extract emits field and value', () => {
        s.extract({ field: 'price', value: '$9.99', status: 'success' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.event).toBe('extract');
        expect(obj.field).toBe('price');
        expect(obj.value).toBe('$9.99');
    });

    it('instructionError', () => {
        s.instructionError({ instructionType: 'extract', error: 'parse failed' });
        const obj = parseLine(stream.lines[0]);
        expect(obj.event).toBe('error');
        expect(obj.instruction).toBe('extract');
        expect(obj.error).toBe('parse failed');
    });

    it('does not throw on stream write error', () => {
        const badStream = { write() { throw new Error('broken pipe'); } };
        const bs = new NdjsonStreamer(badStream, true);
        expect(() => bs.emit({ event: 'test', timestamp: new Date().toISOString() })).not.toThrow();
    });
});

describe('NdjsonStreamer (env var activation)', () => {
    it('enables when NDJSON_STREAM=true', () => {
        const orig = process.env.NDJSON_STREAM;
        try {
            process.env.NDJSON_STREAM = 'true';
            const stream = makeStream();
            const s = new NdjsonStreamer(stream);
            expect(s.enabled).toBe(true);
        } finally {
            if (orig === undefined) delete process.env.NDJSON_STREAM;
            else process.env.NDJSON_STREAM = orig;
        }
    });

    it('disables when NDJSON_STREAM unset', () => {
        const orig = process.env.NDJSON_STREAM;
        try {
            delete process.env.NDJSON_STREAM;
            const stream = makeStream();
            const s = new NdjsonStreamer(stream);
            expect(s.enabled).toBe(false);
        } finally {
            if (orig !== undefined) process.env.NDJSON_STREAM = orig;
        }
    });
});
