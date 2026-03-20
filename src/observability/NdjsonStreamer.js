/**
 * NdjsonStreamer — opt-in real-time NDJSON event stream for browser actions.
 *
 * Activated by env var: NDJSON_STREAM=true
 * Output stream: process.stderr (default; avoids interleaving with Winston stdout logs) or any writable stream.
 *
 * Each event is one JSON object per line (newline-delimited JSON / NDJSON).
 */

export class NdjsonStreamer {
    /**
     * @param {NodeJS.WritableStream} [stream] - defaults to process.stderr
     * @param {boolean} [enabled] - defaults to NDJSON_STREAM env var
     */
    constructor(stream = process.stderr, enabled = process.env.NDJSON_STREAM === 'true') {
        this._stream = stream;
        this._enabled = enabled;
    }

    /** Whether streaming is active. */
    get enabled() {
        return this._enabled;
    }

    /**
     * Emit a single NDJSON event line.
     * @param {Object} event - must include at least { event, timestamp }
     */
    emit(event) {
        if (!this._enabled) return;
        try {
            this._stream.write(JSON.stringify(event) + '\n');
        } catch {
            // non-fatal; observability must not break core flow
        }
    }

    // ── convenience emitters ─────────────────────────────────────────────────

    taskStart({ prompt }) {
        this.emit({ event: 'task_start', timestamp: iso(), prompt });
    }

    taskEnd({ startMs, status, error }) {
        const duration_ms = Date.now() - startMs;
        const ev = { event: 'task_end', timestamp: iso(), duration_ms, status };
        if (error) ev.error = error;
        this.emit(ev);
    }

    navigation({ url, status, error }) {
        const ev = { event: 'navigation', timestamp: iso(), url, status };
        if (error) ev.error = error;
        this.emit(ev);
    }

    action({ actionType, selector, value, valueLength, status, error }) {
        const ev = { event: actionType, timestamp: iso(), selector, status };
        if (value !== undefined) ev.value = value;
        if (valueLength !== undefined) ev.valueLength = valueLength;
        if (error) ev.error = error;
        this.emit(ev);
    }

    extract({ field, value, status, error }) {
        const ev = { event: 'extract', timestamp: iso(), field, value, status };
        if (error) ev.error = error;
        this.emit(ev);
    }

    instructionError({ instructionType, error }) {
        this.emit({ event: 'error', timestamp: iso(), instruction: instructionType, error });
    }
}

function iso() {
    return new Date().toISOString();
}

/** Singleton used by Operations.js (avoids passing instance through every call). */
export const streamer = new NdjsonStreamer();
