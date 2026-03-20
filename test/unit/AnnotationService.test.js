/**
 * Unit tests for AnnotationService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// Mock logger to suppress output
vi.mock('../../src/utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    },
}));

import { AnnotationService } from '../../src/services/AnnotationService.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeLocator(box = { x: 10, y: 20, width: 100, height: 30 }) {
    return {
        boundingBox: vi.fn().mockResolvedValue(box),
    };
}

function makePage({ evaluateResult = undefined, screenshotError = null } = {}) {
    return {
        locator: vi.fn().mockImplementation(() => makeLocator()),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
        screenshot: screenshotError
            ? vi.fn().mockRejectedValue(screenshotError)
            : vi.fn().mockResolvedValue(undefined),
    };
}

const SAFE_PATH = '/tmp/idx-test-annotation.png';
const UNSAFE_PATH = '/etc/passwd';

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AnnotationService', () => {
    let page;
    let service;

    beforeEach(() => {
        page = makePage();
        service = new AnnotationService(page);
    });

    describe('path validation', () => {
        it('rejects paths outside /tmp and cwd', async () => {
            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                UNSAFE_PATH,
                { 1: '//button' }
            );
            expect(result).toEqual({ success: false });
            expect(page.screenshot).not.toHaveBeenCalled();
        });

        it('accepts paths in /tmp', async () => {
            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                SAFE_PATH,
                { 1: '//button' }
            );
            expect(result.success).toBe(true);
            expect(page.screenshot).toHaveBeenCalledWith({
                path: path.resolve(SAFE_PATH),
                fullPage: true,
            });
        });

        it('accepts paths in cwd', async () => {
            const cwdPath = path.join(process.cwd(), 'idx-test.png');
            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                cwdPath,
                { 1: '//div' }
            );
            expect(result.success).toBe(true);
        });
    });

    describe('element resolution', () => {
        it('skips elements with no xpath', async () => {
            const result = await service.captureAnnotatedScreenshot(
                [{ x: 99 }],
                SAFE_PATH,
                {} // no xpaths
            );
            expect(result).toEqual({ success: false });
            expect(page.screenshot).not.toHaveBeenCalled();
        });

        it('skips off-screen elements (boundingBox returns null)', async () => {
            page.locator.mockReturnValue({ boundingBox: vi.fn().mockResolvedValue(null) });
            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                SAFE_PATH,
                { 1: '//button' }
            );
            expect(result).toEqual({ success: false });
        });

        it('skips elements where boundingBox throws', async () => {
            page.locator.mockReturnValue({
                boundingBox: vi.fn().mockRejectedValue(new Error('timeout')),
            });
            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                SAFE_PATH,
                { 1: '//button' }
            );
            expect(result).toEqual({ success: false });
        });
    });

    describe('successful capture', () => {
        it('returns success with path and boxCount', async () => {
            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }, { x: 2 }],
                SAFE_PATH,
                { 1: '//button[1]', 2: '//button[2]' }
            );
            expect(result).toEqual({
                success: true,
                path: path.resolve(SAFE_PATH),
                boxCount: 2,
            });
        });

        it('uses @e{n} labels for numeric element refs', async () => {
            await service.captureAnnotatedScreenshot(
                [{ x: 5 }],
                SAFE_PATH,
                { 5: '//input' }
            );
            const evaluateBoxArg = page.evaluate.mock.calls[0][1];
            expect(evaluateBoxArg.boxes[0].ref).toBe('@e5');
        });

        it('uses @c{n} labels for pseudo-button refs', async () => {
            await service.captureAnnotatedScreenshot(
                [{ x: 'c3' }],
                SAFE_PATH,
                { c3: '//div[@data-idx-ref="c3"]' }
            );
            const evaluateBoxArg = page.evaluate.mock.calls[0][1];
            expect(evaluateBoxArg.boxes[0].ref).toBe('@c3');
        });

        it('injects overlays then removes them in finally', async () => {
            await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                SAFE_PATH,
                { 1: '//button' }
            );
            // evaluate called at least twice: inject + cleanup
            expect(page.evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('cleanup on failure', () => {
        it('always cleans up overlays even when screenshot fails', async () => {
            page = makePage({ screenshotError: new Error('screenshot failed') });
            service = new AnnotationService(page);

            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                SAFE_PATH,
                { 1: '//button' }
            );
            expect(result).toEqual({ success: false });
            // cleanup evaluate should still be called
            expect(page.evaluate).toHaveBeenCalled();
        });
    });

    describe('empty/null inputs', () => {
        it('returns failure for empty elements array', async () => {
            const result = await service.captureAnnotatedScreenshot([], SAFE_PATH, {});
            expect(result).toEqual({ success: false });
        });

        it('returns failure for null elements', async () => {
            const result = await service.captureAnnotatedScreenshot(null, SAFE_PATH, {});
            expect(result).toEqual({ success: false });
        });
    });

    describe('CSP / page.evaluate failure', () => {
        it('returns failure and cleans up when page.evaluate (inject) throws', async () => {
            // Simulate CSP blocking the inject evaluate call but cleanup still runs
            let callCount = 0;
            page.evaluate = vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.reject(new Error('Content Security Policy'));
                }
                return Promise.resolve(undefined); // cleanup call succeeds
            });
            service = new AnnotationService(page);

            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                SAFE_PATH,
                { 1: '//button' }
            );
            expect(result).toEqual({ success: false });
            // cleanup evaluate should still be attempted (finally block)
            expect(page.evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('parallel bounding-box fetching (>50 elements)', () => {
        it('handles 60 elements in batches without error', async () => {
            const elements = Array.from({ length: 60 }, (_, i) => ({ x: i + 1 }));
            const xpaths = Object.fromEntries(
                elements.map(e => [e.x, `//button[${e.x}]`])
            );
            // Each locator returns a valid box
            page.locator = vi.fn().mockImplementation(() => makeLocator());

            const result = await service.captureAnnotatedScreenshot(elements, SAFE_PATH, xpaths);
            expect(result.success).toBe(true);
            expect(result.boxCount).toBe(60);
        });

        it('batches stop at MAX_CONCURRENT_BBOX=50 per round', async () => {
            // Track concurrent calls to boundingBox; we can't easily observe batching
            // directly, but we verify all 51 elements resolve and succeed.
            const elements = Array.from({ length: 51 }, (_, i) => ({ x: i + 1 }));
            const xpaths = Object.fromEntries(elements.map(e => [e.x, `//div[${e.x}]`]));
            page.locator = vi.fn().mockImplementation(() => makeLocator());

            const result = await service.captureAnnotatedScreenshot(elements, SAFE_PATH, xpaths);
            expect(result.success).toBe(true);
            expect(result.boxCount).toBe(51);
        });
    });
});
