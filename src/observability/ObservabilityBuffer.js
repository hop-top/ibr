/**
 * Multi-channel ring buffer for console + network observability.
 * Capacity: 100 entries per instance (shared across channels).
 */

const SENSITIVE_PARAMS = ['token', 'key', 'password', 'api_key', 'secret'];

/**
 * Strip sensitive query params from a URL string.
 * For cross-origin requests (hostname differs from pageOriginHostname),
 * returns only the protocol+hostname (no path/query).
 * @param {string} rawUrl
 * @param {string|null} pageOriginHostname - hostname of the page under test
 * @returns {string}
 */
function sanitizeUrl(rawUrl, pageOriginHostname = null) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return rawUrl;
    }

    if (pageOriginHostname && parsed.hostname !== pageOriginHostname) {
        return `${parsed.protocol}//${parsed.hostname}`;
    }

    // Strip sensitive query params
    for (const param of SENSITIVE_PARAMS) {
        // Match param= followed by any value; handles & separators
        const pattern = new RegExp(
            `([?&])${param}=[^&]*(&?)`,
            'gi'
        );
        parsed.search = parsed.search.replace(pattern, (_, prefix, suffix) => {
            if (prefix === '?' && suffix === '&') return '?';
            if (prefix === '&' && suffix === '&') return '&';
            if (prefix === '?' && suffix === '') return '';
            if (prefix === '&' && suffix === '') return '';
            return '';
        });
        // Clean up trailing ? or & left behind
        if (parsed.search === '?') parsed.search = '';
    }

    return parsed.toString();
}

export class ObservabilityBuffer {
    /**
     * @param {number} capacity - Max entries before oldest are dropped
     * @param {string|null} pageOriginHostname - hostname of the page under test; used to identify cross-origin requests
     */
    constructor(capacity = 100, pageOriginHostname = null) {
        this.capacity = capacity;
        this.pageOriginHostname = pageOriginHostname;
        this._buf = [];
        this.totalAdded = 0;
    }

    /**
     * Record a browser console log entry.
     * @param {string} level - e.g. 'log', 'warn', 'error'
     * @param {string} text
     */
    addConsoleLog(level, text) {
        this._push({ type: 'console', level, text, ts: Date.now() });
    }

    /**
     * Record an outgoing network request.
     * @param {string} method - HTTP method
     * @param {string} url - Raw URL (will be sanitized)
     * @returns {number} Index of entry in internal buffer for response matching
     */
    addNetworkRequest(method, url) {
        const entry = {
            type: 'network',
            method,
            url: sanitizeUrl(url, this.pageOriginHostname),
            _rawUrl: url,
            status: null,
            duration: null,
            ts: Date.now(),
        };
        this._push(entry);
        return this._buf.length - 1;
    }

    /**
     * Match a completed network response to its request entry and update it.
     * Searches backward for the last entry with matching URL.
     * @param {string} url - Response URL
     * @param {number} status - HTTP status code
     * @param {number} duration - Duration in ms
     */
    matchNetworkResponse(url, status, duration) {
        for (let i = this._buf.length - 1; i >= 0; i--) {
            const entry = this._buf[i];
            if (entry.type === 'network' && entry._rawUrl === url && entry.status === null) {
                entry.status = status;
                entry.duration = duration;
                return;
            }
        }
    }

    /**
     * Return the last N entries across all channels.
     * @param {number} n
     * @returns {Array<Object>}
     */
    getLast(n = 20) {
        return this._buf.slice(-n);
    }

    /**
     * Compact human-readable flush of the last 20 entries.
     * Includes overflow note if entries were dropped.
     * @returns {string}
     */
    flush() {
        const dropped = this.totalAdded - this.capacity;
        const lines = [];

        if (dropped > 0) {
            lines.push(`[observability] dropped ${dropped} entries (buffer full)`);
        }

        const entries = this.getLast(20);
        for (const e of entries) {
            const t = new Date(e.ts).toISOString();
            if (e.type === 'console') {
                lines.push(`${t} [console:${e.level}] ${e.text}`);
            } else if (e.type === 'network') {
                const status = e.status != null ? e.status : '---';
                const dur = e.duration != null ? `${e.duration}ms` : 'pending';
                lines.push(`${t} [network] ${e.method} ${e.url} → ${status} (${dur})`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Clear the buffer and reset totalAdded counter.
     */
    clear() {
        this._buf = [];
        this.totalAdded = 0;
    }

    // ── internal ──────────────────────────────────────────────────────────────

    _push(entry) {
        this.totalAdded++;
        if (this._buf.length >= this.capacity) {
            this._buf.shift();
        }
        this._buf.push(entry);
    }
}
