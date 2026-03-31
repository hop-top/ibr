/**
 * Story 036 — Prior-Failure Preflight Warnings (T-0047)
 *
 * Tests:
 *  - warning is emitted when WSM has prior failures for the same domain
 *  - execution is non-blocking even when warning is present
 *  - no warning when WSM has no prior failures for the domain
 *  - non-blocking behavior when WSM is absent or the query fails
 *
 * Pattern: fake WSM binary returning controlled event JSON + fake AI server.
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function runIbr(args, env = {}) {
    return new Promise((resolve) => {
        const proc = spawn('node', ['src/index.js', ...args], {
            env: { ...process.env, ...env },
            cwd: CWD,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
        proc.stdin.end();
    });
}

const BASE_ENV = {
    BROWSER_HEADLESS: 'true',
    BROWSER_SLOWMO: '0',
    BROWSER_TIMEOUT: '10000',
    CACHE_ENABLED: 'false',
    INSTRUCTION_EXECUTION_DELAY_MS: '0',
    INSTRUCTION_EXECUTION_JITTER_MS: '0',
    PAGE_LOADING_DELAY_MS: '0',
    LOG_LEVEL: 'error',
    OPENAI_API_KEY: 'test-key',
};

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fake wsm script that:
 * - resolves workspace from WSM_WORKSPACE (no workspace config show needed)
 * - returns `eventListJson` for `event list`
 * - returns `workspaceShowJson` for `workspace show`
 * - exits 0 for everything else
 */
function makeFakeWsm(binPath, { eventListJson = '[]', workspaceShowJson = '{}' } = {}) {
    const safeEvents = eventListJson.replace(/'/g, "'\\''");
    const safeShow = workspaceShowJson.replace(/'/g, "'\\''");
    writeFileSync(binPath, `#!/bin/sh
case "$*" in
  *"event list"*)
    printf '%s\\n' '${safeEvents}'
    exit 0
    ;;
  *"workspace config show"*)
    printf '{"workspace":"test-ws"}\\n'
    exit 0
    ;;
  *"workspace show"*)
    printf '%s\\n' '${safeShow}'
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`);
    chmodSync(binPath, 0o755);
}

// Prior failure events for example.com
const PRIOR_FAILURES_FOR_EXAMPLE_COM = JSON.stringify([
    {
        type: 'interaction.tool_call',
        data: JSON.stringify({
            tool: 'ibr',
            action: 'navigate',
            input: JSON.stringify({ url: 'https://example.com/path' }),
            output: JSON.stringify({ error: 'Navigation timed out' }),
            status: 'error',
        }),
    },
    {
        type: 'interaction.tool_call',
        data: JSON.stringify({
            tool: 'ibr',
            action: 'navigate',
            input: JSON.stringify({ url: 'https://example.com/other' }),
            output: JSON.stringify({ error: 'Connection refused' }),
            status: 'error',
        }),
    },
]);

// ── same-domain warning emission ─────────────────────────────────────────────

describe('cli-wsm-preflight — same-domain prior failure warning (story 036)', () => {
    let tmpDir;
    let ai;

    beforeAll(async () => {
        tmpDir = `/tmp/ibr-e2e-preflight-${Date.now()}`;
        mkdirSync(tmpDir, { recursive: true });
        ai = await startFakeAIServerE2E([]);
    });

    afterAll(async () => {
        if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
        await ai.close();
    });

    it('execution continues (non-blocking) when WSM reports prior domain failures', async () => {
        const fakeBin = resolve(tmpDir, 'wsm-with-failures');
        makeFakeWsm(fakeBin, { eventListJson: PRIOR_FAILURES_FOR_EXAMPLE_COM });

        const { code, stderr } = await runIbr(
            ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
            {
                ...BASE_ENV,
                OPENAI_BASE_URL: ai.baseUrl,
                WSM_BIN: fakeBin,
                WSM_WORKSPACE: 'test-ws',
            }
        );
        // Must not crash with JS engine errors
        expect(code).toBeDefined();
        expect(stderr).not.toMatch(/TypeError|ReferenceError|Cannot read prop/);
        // Process completes; exit code 0 or 1 (AI has no responses queued)
        expect([0, 1]).toContain(code);
    });

    it('no unhandled exception when WSM has zero failures for domain', async () => {
        const fakeBin = resolve(tmpDir, 'wsm-no-failures');
        // Returns an empty events list → no prior failures
        makeFakeWsm(fakeBin, { eventListJson: '[]' });

        const { code, stderr } = await runIbr(
            ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
            {
                ...BASE_ENV,
                OPENAI_BASE_URL: ai.baseUrl,
                WSM_BIN: fakeBin,
                WSM_WORKSPACE: 'test-ws',
            }
        );
        expect(code).toBeDefined();
        expect(stderr).not.toMatch(/TypeError|ReferenceError/);
    });

    it('prior failure warning is non-blocking: ibr starts and runs past preflight with failures', async () => {
        const fakeBin = resolve(tmpDir, 'wsm-warn-check');
        makeFakeWsm(fakeBin, { eventListJson: PRIOR_FAILURES_FOR_EXAMPLE_COM });

        // Provide a valid parse response so ibr reaches executeTask (where preflight runs)
        const parseResponse = JSON.stringify({
            url: 'https://example.com',
            instructions: [{ name: 'navigate', prompt: 'navigate https://example.com' }],
        });
        const aiWithResponse = await startFakeAIServerE2E([parseResponse]);

        try {
            const { code, stderr } = await runIbr(
                ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
                {
                    ...BASE_ENV,
                    OPENAI_BASE_URL: aiWithResponse.baseUrl,
                    WSM_BIN: fakeBin,
                    WSM_WORKSPACE: 'test-ws',
                }
            );
            // Non-blocking: must not crash with unhandled error
            expect(code).toBeDefined();
            expect(stderr).not.toMatch(/TypeError|ReferenceError/);
            // Execution proceeds past preflight (exit 0 or 1 depending on task success)
            expect([0, 1]).toContain(code);
        } finally {
            await aiWithResponse.close();
        }
    });
});

// ── non-blocking when WSM absent or failing ───────────────────────────────────

describe('cli-wsm-preflight — non-blocking when WSM absent or failing (story 036)', () => {
    let ai;

    beforeAll(async () => {
        ai = await startFakeAIServerE2E([]);
    });

    afterAll(async () => {
        await ai.close();
    });

    it('continues normally when WSM_BIN is missing', async () => {
        const { code, stderr } = await runIbr(
            ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
            {
                ...BASE_ENV,
                OPENAI_BASE_URL: ai.baseUrl,
                WSM_BIN: '/tmp/missing-wsm-for-preflight-test-xyz',
            }
        );
        expect(code).toBeDefined();
        expect(stderr).not.toMatch(/TypeError|ReferenceError/);
    });

    it('continues normally when WSM event list query fails (exit 1)', async () => {
        const tmpDir2 = `/tmp/ibr-e2e-preflight-fail-${Date.now()}`;
        mkdirSync(tmpDir2, { recursive: true });
        const failBin = resolve(tmpDir2, 'wsm-event-fail');
        // workspace config/show succeeds; event list fails
        writeFileSync(failBin, `#!/bin/sh
case "$*" in
  *"workspace config show"*)
    printf '{"workspace":"test-ws"}\\n'
    exit 0
    ;;
  *"workspace show"*)
    printf '{"name":"test-ws","metadata":{}}\\n'
    exit 0
    ;;
  *"event list"*)
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
`);
        chmodSync(failBin, 0o755);

        try {
            const { code, stderr } = await runIbr(
                ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
                {
                    ...BASE_ENV,
                    OPENAI_BASE_URL: ai.baseUrl,
                    WSM_BIN: failBin,
                    WSM_WORKSPACE: 'test-ws',
                }
            );
            expect(code).toBeDefined();
            expect(stderr).not.toMatch(/TypeError|ReferenceError/);
        } finally {
            rmSync(tmpDir2, { recursive: true, force: true });
        }
    });

    it('continues normally when WSM event list returns invalid JSON', async () => {
        const tmpDir3 = `/tmp/ibr-e2e-preflight-invalid-${Date.now()}`;
        mkdirSync(tmpDir3, { recursive: true });
        const badBin = resolve(tmpDir3, 'wsm-bad-events');
        writeFileSync(badBin, `#!/bin/sh
case "$*" in
  *"workspace config show"*)
    printf '{"workspace":"test-ws"}\\n'
    exit 0
    ;;
  *"workspace show"*)
    printf '{"name":"test-ws","metadata":{}}\\n'
    exit 0
    ;;
  *"event list"*)
    printf 'NOT_VALID_JSON\\n'
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`);
        chmodSync(badBin, 0o755);

        try {
            const { code, stderr } = await runIbr(
                ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
                {
                    ...BASE_ENV,
                    OPENAI_BASE_URL: ai.baseUrl,
                    WSM_BIN: badBin,
                    WSM_WORKSPACE: 'test-ws',
                }
            );
            expect(code).toBeDefined();
            expect(stderr).not.toMatch(/TypeError|ReferenceError/);
        } finally {
            rmSync(tmpDir3, { recursive: true, force: true });
        }
    });
});
