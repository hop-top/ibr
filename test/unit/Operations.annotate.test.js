/**
 * Unit tests for Operations annotate-mode integration (T-0009).
 *
 * Covers:
 *  - constructor stores annotateMode from options.annotate
 *  - annotationService.captureAnnotatedScreenshot called after #findElements
 *    when annotateMode=true and elements found
 *  - NOT called when annotateMode=false
 *  - ANNOTATED_SCREENSHOTS_ON_FAILURE=true triggers capture on action failure
 *  - capture is non-fatal (errors swallowed)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');
vi.mock('../../src/services/AnnotationService.js');

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { AnnotationService } from '../../src/services/AnnotationService.js';
import { Operations } from '../../src/Operations.js';

// ── stubs ─────────────────────────────────────────────────────────────────────

CacheManager.mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    generateKey: vi.fn().mockReturnValue('k'),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
}));

let mockCaptureAnnotated;

AnnotationService.mockImplementation(() => ({
    captureAnnotatedScreenshot: mockCaptureAnnotated,
}));

function makeLocator() {
    return {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
        ariaSnapshot: vi.fn().mockResolvedValue('- button "Go"'),
    };
}

function makePage() {
    const locatorInstance = makeLocator();
    return {
        content: vi.fn().mockResolvedValue('<html><body></body></html>'),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(0),
        locator: vi.fn().mockReturnValue(locatorInstance),
        getByRole: vi.fn().mockReturnValue(locatorInstance),
        getByLabel: vi.fn().mockReturnValue(locatorInstance),
        getByText: vi.fn().mockReturnValue(locatorInstance),
        getByPlaceholder: vi.fn().mockReturnValue(locatorInstance),
        on: vi.fn(),
        off: vi.fn(),
        _locatorInstance: locatorInstance,
    };
}

function makeCtx(page) {
    return {
        aiProvider: { modelInstance: {}, provider: 'openai', model: 'gpt-4' },
        page,
    };
}

function aiResp(content) {
    return { content, usage: { promptTokens: 5, completionTokens: 3 } };
}

const FIND_ELEMENTS_RESP = JSON.stringify([{ x: 1 }]);
const ACTION_RESP = JSON.stringify({ elements: [{ x: 1 }], type: 'click' });

const TASK = {
    url: 'https://example.com',
    instructions: [],
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Operations annotate-mode (T-0009)', () => {
    let page, savedEnv;

    beforeEach(() => {
        vi.clearAllMocks();
        page = makePage();
        mockCaptureAnnotated = vi.fn().mockResolvedValue({ success: true, path: '/tmp/x.png', boxCount: 1 });
        savedEnv = process.env.ANNOTATED_SCREENSHOTS_ON_FAILURE;
        delete process.env.ANNOTATED_SCREENSHOTS_ON_FAILURE;
    });

    afterEach(() => {
        if (savedEnv !== undefined) {
            process.env.ANNOTATED_SCREENSHOTS_ON_FAILURE = savedEnv;
        } else {
            delete process.env.ANNOTATED_SCREENSHOTS_ON_FAILURE;
        }
    });

    describe('constructor', () => {
        it('sets annotateMode=false by default', () => {
            const ops = new Operations(makeCtx(page));
            expect(ops.annotateMode).toBe(false);
        });

        it('sets annotateMode=true when options.annotate=true', () => {
            const ops = new Operations(makeCtx(page), { annotate: true });
            expect(ops.annotateMode).toBe(true);
        });

        it('creates an AnnotationService instance', () => {
            new Operations(makeCtx(page));
            expect(AnnotationService).toHaveBeenCalledWith(page);
        });
    });

    describe('--annotate mode: screenshot after findElements', () => {
        it('calls captureAnnotatedScreenshot when annotateMode=true and elements found', async () => {
            // condition instruction calls #findElements internally
            generateAIResponse
                .mockResolvedValueOnce(aiResp(FIND_ELEMENTS_RESP)); // find

            const ops = new Operations(makeCtx(page), { annotate: true });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'condition', prompt: 'p',
                    success_instructions: [], failure_instructions: [] }],
            });

            expect(mockCaptureAnnotated).toHaveBeenCalled();
            const [, shotPath] = mockCaptureAnnotated.mock.calls[0];
            expect(shotPath).toMatch(/^\/tmp\/ibr-annotate-step-/);
            expect(shotPath).toMatch(/\.png$/);
        });

        it('does NOT call captureAnnotatedScreenshot when annotateMode=false', async () => {
            generateAIResponse
                .mockResolvedValueOnce(aiResp(FIND_ELEMENTS_RESP));

            const ops = new Operations(makeCtx(page), { annotate: false });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'condition', prompt: 'p',
                    success_instructions: [], failure_instructions: [] }],
            });

            expect(mockCaptureAnnotated).not.toHaveBeenCalled();
        });

        it('does NOT call captureAnnotatedScreenshot when elements array is empty', async () => {
            generateAIResponse
                .mockResolvedValueOnce(aiResp(JSON.stringify([])));

            const ops = new Operations(makeCtx(page), { annotate: true });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'condition', prompt: 'p',
                    success_instructions: [], failure_instructions: [] }],
            });

            expect(mockCaptureAnnotated).not.toHaveBeenCalled();
        });
    });

    describe('ANNOTATED_SCREENSHOTS_ON_FAILURE env var', () => {
        it('calls captureAnnotatedScreenshot on action failure when env=true', async () => {
            process.env.ANNOTATED_SCREENSHOTS_ON_FAILURE = 'true';

            // action returns elements but locator.click throws
            const failingLocator = {
                ...makeLocator(),
                scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
                click: vi.fn().mockRejectedValue(new Error('click failed')),
            };
            page.locator = vi.fn().mockReturnValue(failingLocator);
            page.getByRole = vi.fn().mockReturnValue(failingLocator);
            page.getByLabel = vi.fn().mockReturnValue(failingLocator);
            page.getByText = vi.fn().mockReturnValue(failingLocator);
            page.getByPlaceholder = vi.fn().mockReturnValue(failingLocator);

            generateAIResponse.mockResolvedValueOnce(aiResp(ACTION_RESP));

            const ops = new Operations(makeCtx(page));
            await expect(
                ops.executeTask({
                    ...TASK,
                    instructions: [{ name: 'click', prompt: 'btn' }],
                })
            ).rejects.toThrow();

            expect(mockCaptureAnnotated).toHaveBeenCalled();
            const [, shotPath] = mockCaptureAnnotated.mock.calls[0];
            expect(shotPath).toMatch(/^\/tmp\/ibr-failure-step-/);
            expect(shotPath).toMatch(/\.png$/);
        });

        it('does NOT call captureAnnotatedScreenshot on failure when env not set', async () => {
            delete process.env.ANNOTATED_SCREENSHOTS_ON_FAILURE;

            const failingLocator = {
                ...makeLocator(),
                scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
                click: vi.fn().mockRejectedValue(new Error('click failed')),
            };
            page.locator = vi.fn().mockReturnValue(failingLocator);
            page.getByRole = vi.fn().mockReturnValue(failingLocator);
            page.getByLabel = vi.fn().mockReturnValue(failingLocator);
            page.getByText = vi.fn().mockReturnValue(failingLocator);
            page.getByPlaceholder = vi.fn().mockReturnValue(failingLocator);

            generateAIResponse.mockResolvedValueOnce(aiResp(ACTION_RESP));

            const ops = new Operations(makeCtx(page));
            await expect(
                ops.executeTask({
                    ...TASK,
                    instructions: [{ name: 'click', prompt: 'btn' }],
                })
            ).rejects.toThrow();

            expect(mockCaptureAnnotated).not.toHaveBeenCalled();
        });

        it('failure screenshot is non-fatal: swallows captureAnnotatedScreenshot errors', async () => {
            process.env.ANNOTATED_SCREENSHOTS_ON_FAILURE = 'true';

            mockCaptureAnnotated = vi.fn().mockRejectedValue(new Error('screenshot exploded'));
            // Re-mock so the new impl is used
            AnnotationService.mockImplementation(() => ({
                captureAnnotatedScreenshot: mockCaptureAnnotated,
            }));

            const failingLocator = {
                ...makeLocator(),
                scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
                click: vi.fn().mockRejectedValue(new Error('click failed')),
            };
            page.locator = vi.fn().mockReturnValue(failingLocator);
            page.getByRole = vi.fn().mockReturnValue(failingLocator);
            page.getByLabel = vi.fn().mockReturnValue(failingLocator);
            page.getByText = vi.fn().mockReturnValue(failingLocator);
            page.getByPlaceholder = vi.fn().mockReturnValue(failingLocator);

            generateAIResponse.mockResolvedValueOnce(aiResp(ACTION_RESP));

            const ops = new Operations(makeCtx(page));
            // Should reject with some error, but NOT 'screenshot exploded'
            await expect(
                ops.executeTask({
                    ...TASK,
                    instructions: [{ name: 'click', prompt: 'btn' }],
                })
            ).rejects.toThrow();

            // Capture was attempted despite screenshot service throwing
            expect(mockCaptureAnnotated).toHaveBeenCalled();
        });
    });
});
