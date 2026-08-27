/**
 * ProgressFeedback — long-run progress feedback for multi-instruction tasks.
 *
 * Wraps @hop-top/kit's `ProgressReporter` (kit/progress) and
 * `createStreamWriter` (kit/stream) to surface per-instruction progress
 * (`n/N` + a short label + elapsed) so blocking runs no longer look hung.
 *
 * Stream discipline (kit/stream, Factor 3): progress is human-oriented
 * feedback and goes to STDERR only — never stdout, which is reserved for
 * command output / pipelines. On a TTY, kit renders a human-readable line
 * (with a spinner frame + elapsed for a live indicator); on a non-TTY it
 * emits one structured NDJSON event per step for downstream consumers.
 *
 * Silent under --quiet and when there is nothing to report (total <= 0).
 * Observability must never break the core flow: every write is guarded.
 */
import { ProgressReporter } from '@hop-top/kit/progress';
import { createStreamWriter } from '@hop-top/kit/stream';

/** Spinner frames for the TTY live indicator. */
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Max chars of the instruction prompt to show in the label. */
const LABEL_MAX = 60;

/** Collapse whitespace and truncate a prompt to a short display label. */
function shortLabel(prompt) {
    if (typeof prompt !== 'string' || prompt.length === 0) return '';
    const collapsed = prompt.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= LABEL_MAX) return collapsed;
    return `${collapsed.slice(0, LABEL_MAX - 1)}…`;
}

/** Format elapsed milliseconds as a compact `1.2s` / `1m3s` string. */
function formatElapsed(ms) {
    if (ms < 1000) return `${ms}ms`;
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) {
        const tenths = Math.floor((ms % 1000) / 100);
        return `${totalSeconds}.${tenths}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m${seconds}s`;
}

export class ProgressFeedback {
    /**
     * @param {Object} opts
     * @param {number} opts.total - Total number of top-level instructions (N).
     * @param {boolean} [opts.quiet=false] - Suppress all output when true.
     * @param {NodeJS.WritableStream} [opts.stream] - Human stream. Defaults to
     *   kit/stream's human stream (process.stderr).
     * @param {boolean} [opts.isTTY] - Whether the human stream is a TTY. Defaults
     *   to process.stderr.isTTY (the stream progress actually writes to).
     * @param {string} [opts.phase='run'] - Phase label for progress events.
     * @param {() => number} [opts.now=Date.now] - Injectable clock (testing).
     */
    constructor({ total, quiet = false, stream, isTTY, phase = 'run', now = Date.now } = {}) {
        this._total = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
        this._quiet = !!quiet;
        this._phase = phase;
        this._now = now;
        this._current = 0;
        this._spinnerFrame = 0;
        this._startMs = now();

        // Resolve the human stream via kit/stream so ibr honors the same
        // stdout(data)/stderr(human) split kit defines. Callers may inject a
        // stream (tests, alternate sinks); otherwise use kit's human stream.
        const writer = createStreamWriter({ human: stream });
        this._stream = writer.human;

        // TTY is keyed off the human stream (stderr) — createStreamWriter's own
        // isTTY looks at stdout, which is the wrong signal for stderr progress.
        this._tty = typeof isTTY === 'boolean'
            ? isTTY
            : !!(this._stream && this._stream.isTTY);

        this._reporter = this._stream
            ? new ProgressReporter(this._stream, this._tty)
            : null;
    }

    /** Whether progress will actually be emitted. */
    get enabled() {
        return !this._quiet && this._total > 0 && !!this._reporter;
    }

    /** Number of the total instructions (N). */
    get total() {
        return this._total;
    }

    /**
     * Advance progress by one instruction and emit an event.
     * Safe to call more than N times; current is capped at total.
     * @param {{ name?: string, prompt?: string }} [instruction]
     */
    advance(instruction = {}) {
        if (!this.enabled) return;
        if (this._current < this._total) this._current += 1;

        const step = typeof instruction.name === 'string' && instruction.name
            ? instruction.name
            : 'step';
        const label = shortLabel(instruction.prompt);
        const elapsed = formatElapsed(this._now() - this._startMs);
        const percent = Math.round((this._current / this._total) * 100);

        // Live indicator: spinner frame (TTY only) + elapsed, plus the label.
        const spinner = this._tty ? `${SPINNER[this._spinnerFrame % SPINNER.length]} ` : '';
        this._spinnerFrame += 1;
        const message = `${spinner}${label ? `${label} ` : ''}(${elapsed})`.trim();

        this._safeEmit({
            phase: this._phase,
            step,
            current: this._current,
            total: this._total,
            percent,
            message,
        });
    }

    /**
     * Finalize progress on successful completion.
     * @param {string} [message]
     */
    finish(message = 'done') {
        if (!this.enabled) return;
        const elapsed = formatElapsed(this._now() - this._startMs);
        this._safeDone(`${message} (${elapsed})`);
    }

    /**
     * Finalize progress on failure. Emits a terminal event noting the failure
     * so a non-TTY consumer sees the run ended.
     * @param {string} [message]
     */
    fail(message = 'failed') {
        if (!this.enabled) return;
        const elapsed = formatElapsed(this._now() - this._startMs);
        this._safeDone(`${message} (${elapsed})`);
    }

    _safeEmit(event) {
        try {
            this._reporter.emit(event);
        } catch {
            // Observability must not break the core flow.
        }
    }

    _safeDone(message) {
        try {
            this._reporter.done(message);
        } catch {
            // Observability must not break the core flow.
        }
    }
}
