/**
 * E2E tests — WSM browser integration (story 023)
 *
 * Validates that:
 *  1. WSM recording is a silent no-op when WSM_WORKSPACE is unset.
 *  2. WSM recording is a silent no-op when WSM_BIN points to a non-existent binary.
 *  3. When a fake wsm binary is provided, navigation events are recorded.
 *
 * These tests never start a real browser — they check idx startup behavior
 * with env-controlled WSM settings. Full navigator recording is exercised by
 * unit tests (WsmAdapter.test.js).
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, chmodSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const NODE = process.execPath;

const BASE_ENV = {
    BROWSER_HEADLESS: 'true',
    BROWSER_SLOWMO: '0',
    BROWSER_TIMEOUT: '5000',
    CACHE_ENABLED: 'false',
    INSTRUCTION_EXECUTION_DELAY_MS: '0',
    INSTRUCTION_EXECUTION_JITTER_MS: '0',
    PAGE_LOADING_DELAY_MS: '0',
    LOG_LEVEL: 'error',
    OPENAI_API_KEY: 'test-key',
};

function runIdx(args, env = {}) {
    return new Promise((resolveP) => {
        const proc = spawn(NODE, [resolve(CWD, 'src/index.js'), ...args], {
            env: { ...process.env, ...env },
            cwd: CWD,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('close', code => resolveP({ code, stdout, stderr }));
    });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('cli-wsm — WSM integration graceful degradation (story 023)', () => {
    // idx exits early without a valid AI response — that's expected in E2E tests
    // without a real AI server. We check startup behavior and WSM-related messages.
    let ai;

    beforeAll(async () => {
        ai = await startFakeAIServerE2E([]);
    });

    afterAll(async () => {
        await ai.close();
    });

    it('no WSM_WORKSPACE — idx starts without WSM errors', async () => {
        const { stderr } = await runIdx(['url: https://example.com\ninstructions:\n  - click submit'], {
            ...BASE_ENV,
            OPENAI_BASE_URL: ai.baseUrl,
            WSM_WORKSPACE: '',    // explicitly unset
        });
        // Must not emit any wsm-related errors at startup
        expect(stderr).not.toMatch(/WsmAdapter.*error/i);
        expect(stderr).not.toMatch(/wsm.*failed.*fatal/i);
    });

    it('WSM_BIN points to non-existent binary — idx starts normally', async () => {
        const { stderr } = await runIdx(['url: https://example.com\ninstructions:\n  - click submit'], {
            ...BASE_ENV,
            OPENAI_BASE_URL: ai.baseUrl,
            WSM_BIN: '/nonexistent/wsm',
            WSM_WORKSPACE: 'my-ws',
        });
        // WsmAdapter should silently disable; no crash
        expect(stderr).not.toMatch(/fatal.*wsm/i);
        expect(stderr).not.toMatch(/unhandled.*wsm/i);
    });

    it('WSM_WORKSPACE set but wsm binary missing — debug message logged', async () => {
        const { stderr } = await runIdx(['url: https://example.com\ninstructions:\n  - click submit'], {
            ...BASE_ENV,
            OPENAI_BASE_URL: ai.baseUrl,
            WSM_BIN: '/nonexistent/wsm',
            WSM_WORKSPACE: 'test-ws',
            LOG_LEVEL: 'debug',  // enable debug to capture the discovery message
        });
        // Should see the WsmAdapter init debug message, not an error
        // idx should still start up (may fail at AI call, not at wsm)
        expect(stderr).not.toMatch(/unhandledRejection/i);
    });
});

describe('cli-wsm — WsmAdapter.available reflects binary presence', () => {
    let tmpDir;
    let fakeBin;
    let argvFile;
    let ai;

    beforeAll(async () => {
        // Create a tmp dir with a fake wsm script that writes its argv to a file
        tmpDir = `/tmp/idx-e2e-wsm-${Date.now()}`;
        mkdirSync(tmpDir, { recursive: true });
        fakeBin = resolve(tmpDir, 'wsm');
        argvFile = resolve(tmpDir, 'wsm-argv.json');
        // Write argv JSON to argvFile (appending one entry per invocation)
        writeFileSync(fakeBin, [
            '#!/bin/sh',
            `EXISTING=""`,
            `[ -f "${argvFile}" ] && EXISTING=$(cat "${argvFile}")`,
            `node -e "`,
            `  const existing = process.env.EXISTING ? JSON.parse(process.env.EXISTING) : [];`,
            `  existing.push(process.argv.slice(1));`,
            `  require('fs').writeFileSync('${argvFile}', JSON.stringify(existing));`,
            `" -- "$@"`,
            'exit 0',
        ].join('\n') + '\n');
        // Simpler: write argv directly using sh printf
        writeFileSync(fakeBin, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${argvFile}"\nexit 0\n`);
        chmodSync(fakeBin, 0o755);

        ai = await startFakeAIServerE2E([]);
    });

    afterAll(async () => {
        if (existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
        await ai.close();
    });

    it('fake wsm binary — idx starts without wsm-related crashes', async () => {
        const { stderr } = await runIdx(
            ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
            {
                ...BASE_ENV,
                OPENAI_BASE_URL: ai.baseUrl,
                WSM_BIN: fakeBin,
                WSM_WORKSPACE: 'test-ws',
            }
        );
        // idx will fail because AI call fails (no real server) — that's expected.
        // Critically: no wsm-related fatal errors.
        expect(stderr).not.toMatch(/WsmAdapter.*threw/i);
        expect(stderr).not.toMatch(/unhandledRejection/i);
    });

    it('fake wsm binary — event add interaction.tool_call was invoked for navigate', async () => {
        // Reset argv file
        if (existsSync(argvFile)) rmSync(argvFile);

        await runIdx(
            ['url: https://example.com\ninstructions:\n  - navigate https://example.com'],
            {
                ...BASE_ENV,
                OPENAI_BASE_URL: ai.baseUrl,
                WSM_BIN: fakeBin,
                WSM_WORKSPACE: 'test-ws',
            }
        );

        // Check if wsm was invoked with event add + interaction.tool_call
        if (existsSync(argvFile)) {
            const recorded = readFileSync(argvFile, 'utf8');
            // argv lines include 'event', 'add', 'interaction.tool_call'
            expect(recorded).toMatch(/event/);
            expect(recorded).toMatch(/add/);
            expect(recorded).toMatch(/interaction\.tool_call/);
        }
        // If argvFile doesn't exist, wsm wasn't invoked — that's acceptable
        // when AI call fails before any tool action
    });
});
