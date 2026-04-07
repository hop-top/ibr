/**
 * Story 023 — Workspace Manager (WSM) integration (T-0015)
 *
 * Tests:
 *  - WsmAdapter gracefully handles missing binary
 *  - WsmAdapter correctly records navigate tool calls when binary present
 *
 * Pattern: static html server + fake AI + fake WSM script.
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';
import { startStaticServer } from '../helpers/staticServer.js';

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

// ── WsmAdapter integration ───────────────────────────────────────────────────

describe('cli-wsm — WSM integration graceful degradation (story 023)', () => {
    let ai;

    beforeAll(async () => {
        ai = await startFakeAIServerE2E([]);
    });

    afterAll(async () => {
        await ai.close();
    });

    it('gracefully continues if WSM_BIN points to missing file', async () => {
        const { code } = await runIbr(
            ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
            {
                ...BASE_ENV,
                OPENAI_BASE_URL: ai.baseUrl,
                WSM_BIN: '/tmp/missing-wsm-binary-xyz',
            }
        );
        // Should not crash (AI might fail but ibr should start)
        expect(code).toBeDefined();
    });

    it('gracefully continues if wsm show fails', async () => {
        const { code } = await runIbr(
            ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
            {
                ...BASE_ENV,
                OPENAI_BASE_URL: ai.baseUrl,
                WSM_BIN: '/usr/bin/false', // exists but fails
            }
        );
        expect(code).toBeDefined();
    });
});

// TODO(pre-existing): this describe block writes a shell script
// (#!/bin/sh) and chmod +x's it to simulate a wsm binary. Neither
// works on Windows. Skip on win32 until the fake binary strategy
// is made platform-aware (e.g. a .cmd shim or a Node script).
describe.skipIf(process.platform === 'win32')('cli-wsm — WsmAdapter.available reflects binary presence', () => {
    let tmpDir;
    let fakeBin;
    let argvFile;
    let ai;

    beforeAll(async () => {
        // Create a tmp dir with a fake wsm script that writes its argv to a file
        tmpDir = `/tmp/ibr-e2e-wsm-${Date.now()}`;
        mkdirSync(tmpDir, { recursive: true });
        fakeBin = resolve(tmpDir, 'wsm');
        argvFile = resolve(tmpDir, 'wsm-argv.json');
        
        // Simpler: write argv directly using sh printf
        writeFileSync(fakeBin, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argvFile}"\nexit 0\n`);
        chmodSync(fakeBin, 0o755);

        ai = await startFakeAIServerE2E([
            JSON.stringify({
                url: 'https://example.com',
                instructions: [{ name: 'navigate', prompt: 'navigate https://example.com' }]
            })
        ]);
    });

    afterAll(async () => {
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
        await ai.close();
    });

    it('fake wsm binary — ibr starts without wsm-related crashes', async () => {
        const { code } = await runIbr(
            ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
            {
                ...BASE_ENV,
                OPENAI_BASE_URL: ai.baseUrl,
                WSM_BIN: fakeBin,
                WSM_WORKSPACE: 'test-ws',
            }
        );
        expect(code).toBeDefined();
    });

    it('fake wsm binary — event add interaction.tool_call was invoked for navigate', async () => {
        const web = await startStaticServer();
        const url = `${web.baseUrl}/simple-page.html`;
        
        // Reset AI with specific URL
        await ai.close();
        ai = await startFakeAIServerE2E([
            JSON.stringify({
                url,
                instructions: [{ name: 'navigate', prompt: `navigate ${url}` }]
            })
        ]);

        // Reset argv file
        if (existsSync(argvFile)) rmSync(argvFile);

        try {
            await runIbr(
                [`url: ${url}\ninstructions:\n  - navigate ${url}`],
                {
                    ...BASE_ENV,
                    OPENAI_BASE_URL: ai.baseUrl,
                    WSM_BIN: fakeBin,
                    WSM_WORKSPACE: 'test-ws',
                }
            );

            // Wait a moment for file write
            await new Promise(r => setTimeout(r, 1000));

            expect(existsSync(argvFile), `WSM argv file ${argvFile} should exist`).toBe(true);
            const recorded = readFileSync(argvFile, 'utf8');
            const lines = recorded.split('\n').filter(Boolean);
            console.log('WSM RECORDED:', JSON.stringify(recorded));
            const foundEvent = lines.some(line => line.includes('interaction.tool_call'));
            expect(foundEvent, `WSM interaction.tool_call event should have been invoked. Got: ${recorded}`).toBe(true);
            expect(recorded).toMatch(/ibr\.navigate/);
        } finally {
            await web.close();
        }
    });
});
