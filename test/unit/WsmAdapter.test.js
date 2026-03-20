/**
 * Unit tests for WsmAdapter.
 *
 * Strategy: mock child_process.execFile and fs to avoid real wsm invocations.
 * Tests cover discovery, graceful no-op when wsm absent, and each public method.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';

vi.mock('../../src/utils/logger.js');

// Mock child_process at module level so WsmAdapter imports the mock
vi.mock('child_process', () => ({
    execFile: vi.fn(),
}));

// Mock fs so accessSync is configurable in tests
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        accessSync: vi.fn(),
        constants: actual.constants,
    };
});

vi.mock('util', async () => {
    const actual = await vi.importActual('util');
    return {
        ...actual,
        promisify: vi.fn((fn) => {
            // Return promisified version backed by mocked execFile
            return (...args) => new Promise((resolve, reject) => {
                fn(...args, (err, stdout, stderr) => {
                    if (err) reject(err);
                    else resolve({ stdout, stderr });
                });
            });
        }),
    };
});

import * as childProcess from 'child_process';
import * as fsModule from 'fs';

import { WsmAdapter, findWsmBin } from '../../src/services/WsmAdapter.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeExecFile(responses = []) {
    let callIdx = 0;
    return vi.fn((_bin, _args, _opts, callback) => {
        const resp = responses[callIdx] ?? { stdout: '', stderr: '' };
        callIdx++;
        if (resp instanceof Error) {
            callback(resp);
        } else {
            callback(null, resp.stdout ?? '', resp.stderr ?? '');
        }
    });
}

function stubFsAccess(availablePaths = new Set()) {
    fsModule.accessSync.mockImplementation((p) => {
        if (!availablePaths.has(p)) {
            throw new Error('ENOENT');
        }
    });
}

// ── findWsmBin ────────────────────────────────────────────────────────────────

describe('findWsmBin', () => {
    let savedEnv;

    beforeEach(() => {
        savedEnv = { ...process.env };
        delete process.env.WSM_BIN;
        process.env.PATH = '/usr/bin:/usr/local/bin';
        fsModule.accessSync.mockReset();
    });

    afterEach(() => {
        for (const key of Object.keys(process.env)) {
            if (!(key in savedEnv)) delete process.env[key];
        }
        Object.assign(process.env, savedEnv);
    });

    it('returns WSM_BIN when set and executable', () => {
        process.env.WSM_BIN = '/custom/wsm';
        stubFsAccess(new Set(['/custom/wsm']));
        expect(findWsmBin()).toBe('/custom/wsm');
    });

    it('returns null when WSM_BIN set but not executable', () => {
        process.env.WSM_BIN = '/missing/wsm';
        stubFsAccess(new Set());
        expect(findWsmBin()).toBeNull();
    });

    it('returns ~/.local/bin/wsm when present', () => {
        const localBin = `${os.homedir()}/.local/bin/wsm`;
        stubFsAccess(new Set([localBin]));
        expect(findWsmBin()).toBe(localBin);
    });

    it('scans PATH dirs and returns first match', () => {
        process.env.PATH = '/usr/bin:/usr/local/bin';
        stubFsAccess(new Set(['/usr/local/bin/wsm']));
        expect(findWsmBin()).toBe('/usr/local/bin/wsm');
    });

    it('returns null when wsm not found anywhere', () => {
        stubFsAccess(new Set());
        expect(findWsmBin()).toBeNull();
    });
});

// ── WsmAdapter — no-op when bin absent ───────────────────────────────────────

describe('WsmAdapter (wsm absent)', () => {
    let adapter;

    beforeEach(() => {
        childProcess.execFile.mockReset();
        adapter = new WsmAdapter(null); // explicitly no binary
    });

    it('available is false', () => {
        expect(adapter.available).toBe(false);
    });

    it('resolveWorkspace returns null without calling execFile', async () => {
        expect(await adapter.resolveWorkspace()).toBeNull();
        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('recordToolCall is a no-op', async () => {
        await expect(adapter.recordToolCall('click', {}, {}, 100)).resolves.toBeUndefined();
        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('recordDiagnostics is a no-op', async () => {
        await expect(adapter.recordDiagnostics('some log', 'https://example.com')).resolves.toBeUndefined();
        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('recordArtifact is a no-op', async () => {
        await expect(adapter.recordArtifact('/tmp/shot.png')).resolves.toBeUndefined();
        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('getBrowserProfile returns null', async () => {
        expect(await adapter.getBrowserProfile()).toBeNull();
    });

    it('queryDomainFailureCount returns 0', async () => {
        expect(await adapter.queryDomainFailureCount('https://example.com')).toBe(0);
    });
});

// ── WsmAdapter — workspace resolution ────────────────────────────────────────

describe('WsmAdapter.resolveWorkspace', () => {
    afterEach(() => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockReset();
    });

    it('uses WSM_WORKSPACE env var without calling execFile', async () => {
        process.env.WSM_WORKSPACE = 'my-ws';
        const adapter = new WsmAdapter('/fake/wsm');
        const ws = await adapter.resolveWorkspace();
        expect(ws).toBe('my-ws');
        expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('calls wsm workspace config show and parses workspace field', async () => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockImplementation(makeExecFile([
            { stdout: JSON.stringify({ workspace: 'auto-ws' }), stderr: '' },
        ]));
        const adapter = new WsmAdapter('/fake/wsm');
        const ws = await adapter.resolveWorkspace();
        expect(ws).toBe('auto-ws');
    });

    it('caches result and does not call execFile again', async () => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockImplementation(makeExecFile([
            { stdout: JSON.stringify({ workspace: 'cached-ws' }), stderr: '' },
        ]));
        const adapter = new WsmAdapter('/fake/wsm');
        await adapter.resolveWorkspace();
        const callCount = childProcess.execFile.mock.calls.length;
        await adapter.resolveWorkspace();
        expect(childProcess.execFile.mock.calls.length).toBe(callCount); // no new calls
    });

    it('returns null when execFile fails', async () => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockImplementation(makeExecFile([new Error('wsm not found')]));
        const adapter = new WsmAdapter('/fake/wsm');
        const ws = await adapter.resolveWorkspace();
        expect(ws).toBeNull();
    });
});

// ── WsmAdapter.recordToolCall ────────────────────────────────────────────────

describe('WsmAdapter.recordToolCall', () => {
    beforeEach(() => {
        process.env.WSM_WORKSPACE = 'test-ws';
        childProcess.execFile.mockImplementation(makeExecFile([
            { stdout: '', stderr: '' }, // event add
        ]));
    });

    afterEach(() => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockReset();
    });

    it('calls wsm event add with correct args on success', async () => {
        const adapter = new WsmAdapter('/fake/wsm');
        await adapter.recordToolCall('click', { selector: '#btn' }, { status: 'success' }, 150);
        expect(childProcess.execFile).toHaveBeenCalledTimes(1);
        const [_bin, args] = childProcess.execFile.mock.calls[0];
        expect(args).toContain('event');
        expect(args).toContain('add');
        expect(args).toContain('test-ws');
        expect(args).toContain('interaction.tool_call');
        expect(args).toContain('idx.click');
        expect(args).toContain('success');
    });

    it('passes status=error when output has error field', async () => {
        const adapter = new WsmAdapter('/fake/wsm');
        await adapter.recordToolCall('fill', { selector: '#input' }, { error: 'Element not found' }, 50);
        const [_bin, args] = childProcess.execFile.mock.calls[0];
        expect(args).toContain('error');
    });

    it('does not throw when execFile fails', async () => {
        childProcess.execFile.mockImplementation(makeExecFile([new Error('wsm crashed')]));
        const adapter = new WsmAdapter('/fake/wsm');
        await expect(adapter.recordToolCall('click', {}, {}, 0)).resolves.toBeUndefined();
    });
});

// ── WsmAdapter.recordDiagnostics ─────────────────────────────────────────────

describe('WsmAdapter.recordDiagnostics', () => {
    beforeEach(() => {
        process.env.WSM_WORKSPACE = 'test-ws';
        childProcess.execFile.mockImplementation(makeExecFile([{ stdout: '', stderr: '' }]));
    });

    afterEach(() => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockReset();
    });

    it('records diagnostics as interaction.tool_call with status=error', async () => {
        const adapter = new WsmAdapter('/fake/wsm');
        await adapter.recordDiagnostics('404 network error\n403 forbidden', 'https://example.com');
        const [_bin, args] = childProcess.execFile.mock.calls[0];
        expect(args).toContain('interaction.tool_call');
        expect(args).toContain('idx.diagnostics');
        expect(args).toContain('error');
    });

    it('does not throw when execFile fails', async () => {
        childProcess.execFile.mockImplementation(makeExecFile([new Error('wsm down')]));
        const adapter = new WsmAdapter('/fake/wsm');
        await expect(adapter.recordDiagnostics('log', 'https://example.com')).resolves.toBeUndefined();
    });
});

// ── WsmAdapter.recordArtifact ────────────────────────────────────────────────

describe('WsmAdapter.recordArtifact', () => {
    beforeEach(() => {
        process.env.WSM_WORKSPACE = 'test-ws';
        childProcess.execFile.mockImplementation(makeExecFile([{ stdout: '', stderr: '' }]));
    });

    afterEach(() => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockReset();
    });

    it('calls wsm with mutation.artifact and correct path', async () => {
        const adapter = new WsmAdapter('/fake/wsm');
        await adapter.recordArtifact('/tmp/shot.png', 'screenshot');
        const [_bin, args] = childProcess.execFile.mock.calls[0];
        expect(args).toContain('mutation.artifact');
        expect(args).toContain('/tmp/shot.png');
    });

    it('defaults artifactType to screenshot', async () => {
        const adapter = new WsmAdapter('/fake/wsm');
        await adapter.recordArtifact('/tmp/diff.png');
        const [_bin, args] = childProcess.execFile.mock.calls[0];
        const dataIdx = args.indexOf('--data');
        const dataJson = JSON.parse(args[dataIdx + 1]);
        expect(dataJson.type).toBe('screenshot');
    });

    it('does not throw on execFile failure', async () => {
        childProcess.execFile.mockImplementation(makeExecFile([new Error('fail')]));
        const adapter = new WsmAdapter('/fake/wsm');
        await expect(adapter.recordArtifact('/tmp/x.png')).resolves.toBeUndefined();
    });
});

// ── WsmAdapter.getBrowserProfile ─────────────────────────────────────────────

describe('WsmAdapter.getBrowserProfile', () => {
    afterEach(() => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockReset();
    });

    it('returns browser_profile from workspace metadata', async () => {
        process.env.WSM_WORKSPACE = 'test-ws';
        const wsPayload = { metadata: { browser_profile: 'arc' } };
        childProcess.execFile.mockImplementation(makeExecFile([
            { stdout: JSON.stringify(wsPayload), stderr: '' },
        ]));
        const adapter = new WsmAdapter('/fake/wsm');
        expect(await adapter.getBrowserProfile()).toBe('arc');
    });

    it('returns null when metadata.browser_profile absent', async () => {
        process.env.WSM_WORKSPACE = 'test-ws';
        childProcess.execFile.mockImplementation(makeExecFile([
            { stdout: JSON.stringify({ metadata: {} }), stderr: '' },
        ]));
        const adapter = new WsmAdapter('/fake/wsm');
        expect(await adapter.getBrowserProfile()).toBeNull();
    });

    it('returns null on execFile failure', async () => {
        process.env.WSM_WORKSPACE = 'test-ws';
        childProcess.execFile.mockImplementation(makeExecFile([new Error('fail')]));
        const adapter = new WsmAdapter('/fake/wsm');
        expect(await adapter.getBrowserProfile()).toBeNull();
    });
});

// ── WsmAdapter.queryDomainFailureCount ───────────────────────────────────────

describe('WsmAdapter.queryDomainFailureCount', () => {
    afterEach(() => {
        delete process.env.WSM_WORKSPACE;
        childProcess.execFile.mockReset();
    });

    it('counts error events matching the domain', async () => {
        process.env.WSM_WORKSPACE = 'test-ws';
        const events = [
            {
                data: JSON.stringify({
                    tool_name: 'idx.navigate',
                    input: JSON.stringify({ url: 'https://example.com/page' }),
                    status: 'error',
                }),
            },
            {
                data: JSON.stringify({
                    tool_name: 'idx.navigate',
                    input: JSON.stringify({ url: 'https://example.com/other' }),
                    status: 'success',
                }),
            },
            {
                data: JSON.stringify({
                    tool_name: 'idx.navigate',
                    input: JSON.stringify({ url: 'https://other.com/page' }),
                    status: 'error',
                }),
            },
        ];
        childProcess.execFile.mockImplementation(makeExecFile([
            { stdout: JSON.stringify(events), stderr: '' },
        ]));
        const adapter = new WsmAdapter('/fake/wsm');
        expect(await adapter.queryDomainFailureCount('https://example.com/foo')).toBe(1);
    });

    it('returns 0 on empty event list', async () => {
        process.env.WSM_WORKSPACE = 'test-ws';
        childProcess.execFile.mockImplementation(makeExecFile([{ stdout: '[]', stderr: '' }]));
        const adapter = new WsmAdapter('/fake/wsm');
        expect(await adapter.queryDomainFailureCount('https://example.com')).toBe(0);
    });

    it('returns 0 on invalid URL', async () => {
        process.env.WSM_WORKSPACE = 'test-ws';
        const adapter = new WsmAdapter('/fake/wsm');
        expect(await adapter.queryDomainFailureCount('not-a-url')).toBe(0);
    });

    it('returns 0 on execFile failure', async () => {
        process.env.WSM_WORKSPACE = 'test-ws';
        childProcess.execFile.mockImplementation(makeExecFile([new Error('wsm fail')]));
        const adapter = new WsmAdapter('/fake/wsm');
        expect(await adapter.queryDomainFailureCount('https://example.com')).toBe(0);
    });
});
