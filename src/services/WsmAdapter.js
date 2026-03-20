/**
 * WsmAdapter — conditional integration with the Workspace Manager (wsm) CLI.
 *
 * All WSM interaction is opt-in; if the binary is not found or the workspace
 * is not configured, every method is a silent no-op.
 *
 * Discovery order:
 *   1. WSM_BIN env var (explicit override)
 *   2. ~/.local/bin/wsm (common install location)
 *   3. PATH dirs scan
 *
 * Workspace resolution order:
 *   1. WSM_WORKSPACE env var
 *   2. `wsm workspace config show --json` -> active workspace
 *
 * Security: uses execFile (not exec) — arguments are passed as an array and not through a shell,
 * which mitigates shell injection. Some arguments include runtime (possibly user-provided) values
 * that are passed directly to the wsm CLI.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import logger from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const EXEC_TIMEOUT_MS = 5_000;

// ── Discovery ────────────────────────────────────────────────────────────────

/**
 * Locate the wsm binary. Returns path string or null.
 * @returns {string|null}
 */
export function findWsmBin() {
    // 1. Explicit override
    if (process.env.WSM_BIN) {
        const p = process.env.WSM_BIN;
        try {
            fs.accessSync(p, fs.constants.X_OK);
            return p;
        } catch {
            return null;
        }
    }

    // 2. ~/.local/bin/wsm (common non-root install)
    const localBin = path.join(os.homedir(), '.local', 'bin', 'wsm');
    try {
        fs.accessSync(localBin, fs.constants.X_OK);
        return localBin;
    } catch {
        // fall through
    }

    // 3. PATH dirs scan
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
        if (!dir) continue;
        const candidate = path.join(dir, 'wsm');
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        } catch {
            // keep looking
        }
    }

    return null;
}

// ── WsmAdapter ───────────────────────────────────────────────────────────────

export class WsmAdapter {
    /**
     * @param {string|null} [binPath] - path to wsm binary (auto-detected if omitted)
     */
    constructor(binPath) {
        this._bin = binPath !== undefined ? binPath : findWsmBin();
        this._workspace = process.env.WSM_WORKSPACE || null;
        this._workspaceResolved = false;
        logger.debug('WsmAdapter init', { bin: this._bin, workspace: this._workspace });
    }

    /** True when wsm binary is available. */
    get available() {
        return this._bin !== null;
    }

    // ── Workspace resolution ─────────────────────────────────────────────────

    /**
     * Resolve the active workspace name/ID.
     * Cached after first successful resolution.
     * @returns {Promise<string|null>}
     */
    async resolveWorkspace() {
        if (this._workspace) return this._workspace;
        if (this._workspaceResolved) return null; // already tried and failed
        if (!this._bin) return null;

        try {
            const { stdout } = await this._exec(['workspace', 'config', 'show', '--json']);
            const cfg = JSON.parse(stdout.trim());
            const ws = cfg?.workspace || cfg?.active_workspace || cfg?.name || null;
            this._workspace = ws || null;
        } catch {
            this._workspace = null;
        }

        this._workspaceResolved = true;
        logger.debug('WsmAdapter workspace resolved', { workspace: this._workspace });
        return this._workspace;
    }

    // ── Push model: record browser action ────────────────────────────────────

    /**
     * Record a browser action as interaction.tool_call event.
     * Non-fatal — logs warning on failure; never throws.
     *
     * @param {string} actionType - e.g. 'click', 'fill', 'navigate'
     * @param {Object} input      - action details (url, selector, etc.)
     * @param {Object} output     - result details (status, error, etc.)
     * @param {number} durationMs - elapsed time
     */
    async recordToolCall(actionType, input, output, durationMs) {
        if (!this._bin) return;
        const ws = await this.resolveWorkspace();
        if (!ws) return;

        const inputJson = JSON.stringify({ tool: 'idx', action: actionType, ...input });
        const outputJson = JSON.stringify(output);
        const status = output?.error ? 'error' : 'success';

        await this._execNoThrow([
            'event', 'add', ws, 'interaction.tool_call',
            '--tool-name', `idx.${actionType}`,
            '--input', inputJson,
            '--output', outputJson,
            '--status', status,
            '--duration-ms', String(Math.round(durationMs || 0)),
        ], `recordToolCall(${actionType})`);
    }

    // ── Diagnostic streaming: flush observability buffer ─────────────────────

    /**
     * Persist the observability buffer (network + console) as a tool_call event.
     * Used on task failure to preserve diagnostic context in workspace history.
     * Non-fatal.
     *
     * @param {string} diagnosticText - flushed ObservabilityBuffer text
     * @param {string} [taskUrl]
     */
    async recordDiagnostics(diagnosticText, taskUrl) {
        if (!this._bin) return;
        const ws = await this.resolveWorkspace();
        if (!ws) return;

        const inputJson = JSON.stringify({ tool: 'idx', action: 'diagnostics', url: taskUrl || null });
        const outputJson = JSON.stringify({ log: diagnosticText });

        await this._execNoThrow([
            'event', 'add', ws, 'interaction.tool_call',
            '--tool-name', 'idx.diagnostics',
            '--input', inputJson,
            '--output', outputJson,
            '--status', 'error',
        ], 'recordDiagnostics');
    }

    // ── Visual evidence: record artifact path ────────────────────────────────

    /**
     * Record a screenshot or snapshot diff as mutation.artifact.
     * Non-fatal.
     *
     * @param {string} artifactPath - absolute path on disk
     * @param {string} [artifactType] - e.g. 'screenshot', 'snapshot_diff'
     */
    async recordArtifact(artifactPath, artifactType = 'screenshot') {
        if (!this._bin) return;
        const ws = await this.resolveWorkspace();
        if (!ws) return;

        await this._execNoThrow([
            'event', 'add', ws, 'mutation.artifact',
            '--path', artifactPath,
            '--data', JSON.stringify({
                artifact_id: artifactPath,
                type: artifactType,
                path: artifactPath,
            }),
        ], `recordArtifact(${artifactType})`);
    }

    // ── Workspace metadata: browser profile hint ─────────────────────────────

    /**
     * Query WSM workspace metadata for a preferred browser profile.
     * Returns the metadata value of key "browser_profile" if present, else null.
     * Non-fatal.
     *
     * @returns {Promise<string|null>}
     */
    async getBrowserProfile() {
        if (!this._bin) return null;
        const ws = await this.resolveWorkspace();
        if (!ws) return null;

        try {
            const { stdout } = await this._exec(['workspace', 'show', ws, '--json']);
            const data = JSON.parse(stdout.trim());
            return data?.metadata?.browser_profile || null;
        } catch {
            return null;
        }
    }

    // ── Historical pre-flight check ──────────────────────────────────────────

    /**
     * Query WSM for past failure events at a given domain.
     * Returns count of error tool_call events whose input.url matches domain.
     * Non-fatal — returns 0 on any error.
     *
     * @param {string} url - URL being navigated to (domain extracted internally)
     * @returns {Promise<number>} failure count
     */
    async queryDomainFailureCount(url) {
        if (!this._bin) return 0;
        const ws = await this.resolveWorkspace();
        if (!ws) return 0;

        let host;
        try {
            host = new URL(url).host;
        } catch {
            return 0;
        }

        try {
            const { stdout } = await this._exec([
                'event', 'list', ws,
                '--type', 'interaction.tool_call',
                '--json',
            ]);
            const events = JSON.parse(stdout.trim() || '[]');
            if (!Array.isArray(events)) return 0;

            let failures = 0;
            for (const ev of events) {
                try {
                    const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
                    const input = typeof data?.input === 'string'
                        ? JSON.parse(data.input)
                        : data?.input;
                    const evUrl = input?.url || '';
                    if (!evUrl) continue;
                    const evHost = new URL(evUrl).host;
                    if (evHost === host && data?.status === 'error') {
                        failures++;
                    }
                } catch {
                    // skip unparseable events
                }
            }
            return failures;
        } catch {
            return 0;
        }
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /**
     * Run wsm CLI with args; rejects on non-zero exit.
     * Uses execFile (no shell) — safe against injection.
     * @param {string[]} args
     * @returns {Promise<{stdout:string, stderr:string}>}
     */
    _exec(args) {
        return execFileAsync(this._bin, args, { timeout: EXEC_TIMEOUT_MS });
    }

    /**
     * Like _exec but logs warning on failure instead of throwing.
     * @param {string[]} args
     * @param {string} context - label for log message
     */
    async _execNoThrow(args, context) {
        try {
            await this._exec(args);
        } catch (err) {
            logger.warn(`WsmAdapter.${context} failed (non-fatal)`, {
                error: err.message?.slice(0, 200),
            });
        }
    }
}

/** Lazy singleton — deferred past dotenv.config() so WSM_* env vars are set. */
let _instance = null;
function getInstance() {
    if (!_instance) _instance = new WsmAdapter();
    return _instance;
}

export const wsmAdapter = new Proxy({}, {
    get(_t, prop, r) {
        const i = getInstance();
        const v = Reflect.get(i, prop, r);
        return typeof v === 'function' ? v.bind(i) : v;
    },
    set(_t, prop, value, r) { return Reflect.set(getInstance(), prop, value, r); },
    has(_t, prop) { return Reflect.has(getInstance(), prop); },
    ownKeys(_t) { return Reflect.ownKeys(getInstance()); },
    getOwnPropertyDescriptor(_t, prop) { return Reflect.getOwnPropertyDescriptor(getInstance(), prop); },
});
