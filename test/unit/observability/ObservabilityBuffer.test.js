import { describe, it, expect, beforeEach } from 'vitest';
import { ObservabilityBuffer } from '../../../src/observability/ObservabilityBuffer.js';

describe('ObservabilityBuffer', () => {
    let buf;

    beforeEach(() => {
        buf = new ObservabilityBuffer(5); // small capacity for overflow tests
    });

    // ── ring buffer ────────────────────────────────────────────────────────────

    describe('ring buffer', () => {
        it('stores entries up to capacity', () => {
            for (let i = 0; i < 5; i++) buf.addConsoleLog('log', `msg ${i}`);
            expect(buf.getLast(10)).toHaveLength(5);
            expect(buf.totalAdded).toBe(5);
        });

        it('drops oldest entry when at capacity', () => {
            for (let i = 0; i < 6; i++) buf.addConsoleLog('log', `msg ${i}`);
            const entries = buf.getLast(10);
            expect(entries).toHaveLength(5);
            expect(entries[0].text).toBe('msg 1'); // msg 0 dropped
            expect(buf.totalAdded).toBe(6);
        });

        it('getLast returns at most n entries', () => {
            for (let i = 0; i < 5; i++) buf.addConsoleLog('log', `msg ${i}`);
            expect(buf.getLast(3)).toHaveLength(3);
        });

        it('clear resets buffer and totalAdded', () => {
            buf.addConsoleLog('log', 'hello');
            buf.clear();
            expect(buf.getLast(10)).toHaveLength(0);
            expect(buf.totalAdded).toBe(0);
        });
    });

    // ── flush ──────────────────────────────────────────────────────────────────

    describe('flush()', () => {
        it('formats console entries', () => {
            buf.addConsoleLog('warn', 'something broke');
            const out = buf.flush();
            expect(out).toMatch(/\[console:warn\] something broke/);
        });

        it('formats network entries with status and duration', () => {
            buf.addNetworkRequest('GET', 'https://example.com/api');
            buf.matchNetworkResponse('https://example.com/api', 200, 42);
            const out = buf.flush();
            expect(out).toMatch(/\[network\] GET.*→ 200 \(42ms\)/);
        });

        it('shows pending for unmatched network entry', () => {
            buf.addNetworkRequest('POST', 'https://example.com/api');
            const out = buf.flush();
            expect(out).toMatch(/→ --- \(pending\)/);
        });

        it('includes dropped-entries note when buffer overflowed', () => {
            for (let i = 0; i < 7; i++) buf.addConsoleLog('log', `msg ${i}`);
            const out = buf.flush();
            expect(out).toMatch(/dropped 2 entries \(buffer full\)/);
        });

        it('returns empty string when buffer is empty', () => {
            expect(buf.flush()).toBe('');
        });
    });

    // ── URL sanitization ───────────────────────────────────────────────────────

    describe('URL sanitization', () => {
        it('strips sensitive query params', () => {
            buf.addNetworkRequest('GET', 'https://example.com/api?token=abc&foo=bar');
            const entry = buf.getLast(1)[0];
            expect(entry.url).not.toContain('token=');
            expect(entry.url).toContain('foo=bar');
        });

        it('strips all sensitive param names case-insensitively', () => {
            buf.addNetworkRequest('GET', 'https://example.com/?Token=x&KEY=y&Password=z&api_key=w&secret=s&ok=1');
            const entry = buf.getLast(1)[0];
            expect(entry.url).not.toMatch(/token|key|password|api_key|secret/i);
            expect(entry.url).toContain('ok=1');
        });

        it('produces clean URL when only sensitive params remain', () => {
            buf.addNetworkRequest('GET', 'https://example.com/?token=abc');
            const entry = buf.getLast(1)[0];
            expect(entry.url).toBe('https://example.com/');
        });

        it('cross-origin: returns protocol+host only (no path/query)', () => {
            buf.pageOriginHost = 'example.com';
            buf.addNetworkRequest('GET', 'https://cdn.other.com/asset?foo=bar');
            const entry = buf.getLast(1)[0];
            expect(entry.url).toBe('https://cdn.other.com');
        });

        it('same host+port treated as same-origin', () => {
            buf.pageOriginHost = 'example.com:3000';
            buf.addNetworkRequest('GET', 'https://example.com:3000/api?foo=bar');
            const entry = buf.getLast(1)[0];
            expect(entry.url).toContain('/api');
        });

        it('different port treated as cross-origin', () => {
            buf.pageOriginHost = 'example.com:3000';
            buf.addNetworkRequest('GET', 'https://example.com:4000/api?foo=bar');
            const entry = buf.getLast(1)[0];
            expect(entry.url).toBe('https://example.com:4000');
        });

        it('passes through unparseable URLs unchanged', () => {
            buf.addNetworkRequest('GET', 'not-a-url');
            const entry = buf.getLast(1)[0];
            expect(entry.url).toBe('not-a-url');
        });
    });

    // ── matchNetworkResponse ───────────────────────────────────────────────────

    describe('matchNetworkResponse()', () => {
        it('updates the matching pending request', () => {
            buf.addNetworkRequest('GET', 'https://example.com/a');
            buf.matchNetworkResponse('https://example.com/a', 404, 10);
            const entry = buf.getLast(1)[0];
            expect(entry.status).toBe(404);
            expect(entry.duration).toBe(10);
        });

        it('matches last unresolved entry when same URL appears twice', () => {
            buf.addNetworkRequest('GET', 'https://example.com/a');
            buf.matchNetworkResponse('https://example.com/a', 200, 5);
            buf.addNetworkRequest('GET', 'https://example.com/a');
            buf.matchNetworkResponse('https://example.com/a', 301, 8);
            const entries = buf.getLast(10).filter(e => e.type === 'network');
            expect(entries[0].status).toBe(200);
            expect(entries[1].status).toBe(301);
        });

        it('silently ignores unmatched response URL', () => {
            buf.addNetworkRequest('GET', 'https://example.com/a');
            expect(() => buf.matchNetworkResponse('https://example.com/b', 200, 1)).not.toThrow();
        });
    });
});
