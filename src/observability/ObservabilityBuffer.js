/**
 * Multi-channel ring buffer for console + network observability.
 * Capacity: 100 entries per instance (shared across channels).
 */

const SENSITIVE_PARAMS = ['token', 'key', 'password', 'api_key', 'secret'];

/**
 * Strip sensitive query params from a URL string.
 * For cross-origin requests (host differs from pageOriginHost),
 * returns only the protocol+host (no path/query).
 * @param {string} rawUrl
 * @param {string|null} pageOriginHost - host (hostname:port) of the page under test
 * @returns {string}
 */
function sanitizeUrl(rawUrl, pageOriginHost = null) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return rawUrl;
    }

    if (pageOriginHost && parsed.host !== pageOriginHost) {
        return `${parsed.protocol}//${parsed.host}`;
    }

    // Strip sensitive query params using URLSearchParams to avoid malformed separators
    const params = new URLSearchParams(parsed.search);
    const sensitiveLower = new Set(SENSITIVE_PARAMS.map((p) => p.toLowerCase()));
    for (const key of new Set(params.keys())) {
        if (sensitiveLower.has(key.toLowerCase())) {
            params.delete(key);
        }
    }
    const sanitizedQuery = params.toString();
    parsed.search = sanitizedQuery ? `?${sanitizedQuery}` : '';

    return parsed.toString();
}

export class ObservabilityBuffer {
    /**
     * @param {number} capacity - Max entries before oldest are dropped
     * @param {string|null} pageOriginHost - host (hostname:port) of the page under test;
     *   used to identify cross-origin requests
     */
    constructor(capacity = 100, pageOriginHost = null) {
        this.capacity = capacity;
        this.pageOriginHost = pageOriginHost;
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
     */
    addNetworkRequest(method, url) {
        const entry = {
            type: 'network',
            method,
            url: sanitizeUrl(url, this.pageOriginHost),
            _rawUrl: url,
            status: null,
            duration: null,
            ts: Date.now(),
        };
        this._push(entry);
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
