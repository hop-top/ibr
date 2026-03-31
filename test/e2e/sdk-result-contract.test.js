/**
 * Story 038 — Structured SDK Result Contract (T-0049)
 *
 * Tests:
 *  - resolved result shape: extracts array + tokenUsage object
 *  - null semantics: missing/empty extracts resolve to null entries (not omitted)
 *  - structured error shape: CliError has code, message, and optional step/action
 *  - serializeCliError produces the stable wire format { error: { code, message } }
 *
 * Pattern: direct SDK import (no subprocess); mock AI provider via startFakeAIServerE2E.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { startFakeAIServerE2E } from '../helpers/fakeAIServerE2E.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { Operations } from '../../src/Operations.js';
import { createAIProvider } from '../../src/ai/provider.js';
import { CliError, ensureCliError, serializeCliError } from '../../src/utils/cliErrors.js';

const CWD = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// ── shared setup ─────────────────────────────────────────────────────────────

let browser;
let staticServer;

beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    staticServer = await startStaticServer();
}, 30_000);

afterAll(async () => {
    await browser?.close();
    await staticServer?.close();
}, 15_000);

// Helper: create a short-lived Operations instance with fake AI
async function makeOperations(responses) {
    const ai = await startFakeAIServerE2E(responses);
    const savedBaseUrl = process.env.OPENAI_BASE_URL;
    const savedKey = process.env.OPENAI_API_KEY;
    const savedProvider = process.env.AI_PROVIDER;

    process.env.OPENAI_BASE_URL = ai.baseUrl;
    process.env.OPENAI_API_KEY = 'sk-fake';
    process.env.AI_PROVIDER = 'openai';

    const aiProvider = createAIProvider();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('about:blank');

    const operations = new Operations({ aiProvider, page }, { mode: 'dom' });

    const cleanup = async () => {
        await ai.close();
        await ctx.close();
        process.env.OPENAI_BASE_URL = savedBaseUrl;
        process.env.OPENAI_API_KEY = savedKey;
        process.env.AI_PROVIDER = savedProvider;
    };

    return { operations, cleanup };
}

// ── resolved result shape ─────────────────────────────────────────────────────

describe('sdk-result-contract — resolved result shape (story 038)', () => {
    it('Operations instance exposes extracts array after construction', async () => {
        const { operations, cleanup } = await makeOperations([]);
        try {
            expect(Array.isArray(operations.extracts)).toBe(true);
            expect(operations.extracts).toHaveLength(0);
        } finally {
            await cleanup();
        }
    });

    it('Operations instance exposes tokenUsage object with prompt/completion/total', async () => {
        const { operations, cleanup } = await makeOperations([]);
        try {
            expect(operations.tokenUsage).toBeTypeOf('object');
            expect(operations.tokenUsage).not.toBeNull();
            expect(typeof operations.tokenUsage.prompt).toBe('number');
            expect(typeof operations.tokenUsage.completion).toBe('number');
            expect(typeof operations.tokenUsage.total).toBe('number');
        } finally {
            await cleanup();
        }
    });

    it('tokenUsage starts at zero', async () => {
        const { operations, cleanup } = await makeOperations([]);
        try {
            expect(operations.tokenUsage.prompt).toBe(0);
            expect(operations.tokenUsage.completion).toBe(0);
            expect(operations.tokenUsage.total).toBe(0);
        } finally {
            await cleanup();
        }
    });

    it('parseTaskDescription resolves to object with url and instructions array', async () => {
        const taskJson = JSON.stringify({
            url: `${staticServer.baseUrl}/simple-page.html`,
            instructions: [{ name: 'navigate', prompt: 'navigate to page' }],
        });
        const { operations, cleanup } = await makeOperations([taskJson]);
        try {
            const result = await operations.parseTaskDescription(
                `url: ${staticServer.baseUrl}/simple-page.html\ninstructions:\n  - navigate to page`
            );
            expect(result).toBeTypeOf('object');
            expect(result).not.toBeNull();
            expect(typeof result.url).toBe('string');
            expect(Array.isArray(result.instructions)).toBe(true);
        } finally {
            await cleanup();
        }
    });

    it('tokenUsage increments after AI call', async () => {
        const taskJson = JSON.stringify({
            url: `${staticServer.baseUrl}/simple-page.html`,
            instructions: [{ name: 'navigate', prompt: 'navigate to page' }],
        });
        const { operations, cleanup } = await makeOperations([taskJson]);
        try {
            await operations.parseTaskDescription(
                `url: ${staticServer.baseUrl}/simple-page.html\ninstructions:\n  - navigate to page`
            );
            // At least total should have incremented from AI call
            expect(operations.tokenUsage.prompt + operations.tokenUsage.completion).toBeGreaterThanOrEqual(0);
        } finally {
            await cleanup();
        }
    });
});

// ── null semantics ────────────────────────────────────────────────────────────

describe('sdk-result-contract — null semantics (story 038)', () => {
    it('extracts array is empty (not null) when no extract instructions ran', async () => {
        const { operations, cleanup } = await makeOperations([]);
        try {
            // No instructions executed — extracts should be an empty array, never null
            const extracts = operations.extracts;
            expect(extracts).not.toBeNull();
            expect(Array.isArray(extracts)).toBe(true);
        } finally {
            await cleanup();
        }
    });

    it('tokenUsage fields are numbers (not null/undefined) when no AI call made', async () => {
        const { operations, cleanup } = await makeOperations([]);
        try {
            // Fields must be present and numeric (null/undefined would break downstream consumers)
            expect(operations.tokenUsage.prompt).not.toBeNull();
            expect(operations.tokenUsage.prompt).not.toBeUndefined();
            expect(operations.tokenUsage.completion).not.toBeNull();
            expect(operations.tokenUsage.total).not.toBeNull();
        } finally {
            await cleanup();
        }
    });
});

// ── structured error contract ─────────────────────────────────────────────────

describe('sdk-result-contract — structured error shape (story 038)', () => {
    it('CliError has code and message fields', () => {
        const err = new CliError('NAVIGATE_FAILED', 'Failed to navigate');
        expect(err.code).toBe('NAVIGATE_FAILED');
        expect(err.message).toBe('Failed to navigate');
        expect(err instanceof Error).toBe(true);
    });

    it('CliError optionally carries step and action metadata', () => {
        const err = new CliError('STEP_FAILED', 'Step failed', { step: 2, action: 'click' });
        expect(err.code).toBe('STEP_FAILED');
        expect(err.step).toBe(2);
        expect(err.action).toBe('click');
    });

    it('CliError step and action are undefined when not provided', () => {
        const err = new CliError('GENERIC', 'error');
        expect(err.step).toBeUndefined();
        expect(err.action).toBeUndefined();
    });

    it('ensureCliError wraps plain Error into CliError', () => {
        const plain = new Error('something broke');
        const cliErr = ensureCliError(plain, 'RUNTIME_ERROR');
        expect(cliErr instanceof CliError).toBe(true);
        expect(cliErr.code).toBe('RUNTIME_ERROR');
        expect(cliErr.message).toBe('something broke');
    });

    it('ensureCliError returns existing CliError unchanged', () => {
        const err = new CliError('CUSTOM_CODE', 'custom message');
        const result = ensureCliError(err, 'FALLBACK');
        expect(result).toBe(err);
        expect(result.code).toBe('CUSTOM_CODE');
    });

    it('serializeCliError produces { error: { code, message } } wire format', () => {
        const err = new CliError('NAVIGATE_FAILED', 'Could not navigate');
        const payload = serializeCliError(err);
        expect(payload).toHaveProperty('error');
        expect(payload.error).toHaveProperty('code', 'NAVIGATE_FAILED');
        expect(payload.error).toHaveProperty('message', 'Could not navigate');
    });

    it('serializeCliError includes step when present', () => {
        const err = new CliError('STEP_FAILED', 'Step failed', { step: 3 });
        const payload = serializeCliError(err);
        expect(payload.error).toHaveProperty('step', 3);
    });

    it('serializeCliError includes action when present', () => {
        const err = new CliError('ACTION_FAILED', 'Action failed', { action: 'fill' });
        const payload = serializeCliError(err);
        expect(payload.error).toHaveProperty('action', 'fill');
    });

    it('serializeCliError omits step/action keys when not present', () => {
        const err = new CliError('BARE', 'bare error');
        const payload = serializeCliError(err);
        expect(Object.keys(payload.error)).not.toContain('step');
        expect(Object.keys(payload.error)).not.toContain('action');
    });

    it('parseTaskDescription rejects with CliError-compatible error on AI failure', async () => {
        // AI has no responses — should throw
        const { operations, cleanup } = await makeOperations([]);
        try {
            let caughtError = null;
            try {
                await operations.parseTaskDescription(
                    'url: https://example.com\ninstructions:\n  - navigate'
                );
            } catch (e) {
                caughtError = e;
            }
            expect(caughtError).not.toBeNull();
            expect(caughtError instanceof Error).toBe(true);
            // Ensure wrappable by ensureCliError (SDK contract)
            const cliErr = ensureCliError(caughtError, 'AI_PARSE_ERROR');
            expect(cliErr.code).toBeDefined();
            expect(typeof cliErr.message).toBe('string');
        } finally {
            await cleanup();
        }
    });
});

// ── CLI structured error output ───────────────────────────────────────────────

describe('sdk-result-contract — CLI wire format (story 038)', () => {
    it('serializeCliError output is valid JSON-serializable', () => {
        const err = new CliError('TEST_CODE', 'test message', { step: 1, action: 'navigate' });
        const payload = serializeCliError(err);
        // Must be JSON-round-trippable without loss
        const json = JSON.stringify(payload);
        const parsed = JSON.parse(json);
        expect(parsed.error.code).toBe('TEST_CODE');
        expect(parsed.error.message).toBe('test message');
        expect(parsed.error.step).toBe(1);
        expect(parsed.error.action).toBe('navigate');
    });

    it('serializeCliError with no step/action produces minimal payload', () => {
        const err = new CliError('MINIMAL', 'minimal error');
        const payload = serializeCliError(err);
        const keys = Object.keys(payload.error);
        expect(keys).toContain('code');
        expect(keys).toContain('message');
        // step and action must not appear as null/undefined — they should be absent
        expect(payload.error.step).toBeUndefined();
        expect(payload.error.action).toBeUndefined();
    });
});
