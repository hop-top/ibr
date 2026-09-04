/**
 * Unit tests for the shared overlay core extracted from AnnotationService:
 *   - captureAnnotatedBuffer (in-memory sink, mirrors captureAnnotatedScreenshot)
 *   - grid-overlay rendering (VISUAL_GRID env, default 8x8)
 *   - captureAnnotatedScreenshot keeps writing to the validated disk path
 *
 * Follows the existing mocking pattern in AnnotationService.test.js (mock the
 * Playwright page directly, no real browser).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const SCREENSHOT_BUFFER = Buffer.from('fake-png-bytes');

function makePage({ evaluateResult = undefined, screenshotError = null, viewportSize = { width: 1280, height: 720 } } = {}) {
    return {
        locator: vi.fn().mockImplementation(() => makeLocator()),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
        viewportSize: vi.fn().mockReturnValue(viewportSize),
        screenshot: screenshotError
            ? vi.fn().mockRejectedValue(screenshotError)
            : vi.fn().mockImplementation((opts = {}) => {
                // Disk sink (path given) resolves undefined like Playwright does;
                // buffer sink (no path) resolves a Buffer.
                return Promise.resolve(opts.path ? undefined : SCREENSHOT_BUFFER);
            }),
    };
}

const SAFE_PATH = '/tmp/ibr-test-annotation.png';

// ── tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(process.platform === 'win32')('AnnotationService — shared overlay core', () => {
    let page;
    let service;
    let savedGridEnv;

    beforeEach(() => {
        page = makePage();
        service = new AnnotationService(page);
        savedGridEnv = process.env.VISUAL_GRID;
        delete process.env.VISUAL_GRID;
    });

    afterEach(() => {
        if (savedGridEnv !== undefined) {
            process.env.VISUAL_GRID = savedGridEnv;
        } else {
            delete process.env.VISUAL_GRID;
        }
    });

    describe('captureAnnotatedBuffer', () => {
        it('returns a Buffer + boxes 1:1 with input refs', async () => {
            const result = await service.captureAnnotatedBuffer(
                [{ x: 1 }, { x: 2 }],
                { 1: '//button[1]', 2: '//button[2]' }
            );
            expect(result.success).toBe(true);
            expect(Buffer.isBuffer(result.image)).toBe(true);
            expect(result.mime).toBe('image/png');
            expect(result.boxes).toHaveLength(2);
            expect(result.boxes.map(b => b.ref)).toEqual(['@e1', '@e2']);
            expect(result.boxes[0]).toHaveProperty('box');
        });

        it('calls page.screenshot with no path (in-memory)', async () => {
            await service.captureAnnotatedBuffer([{ x: 1 }], { 1: '//button' });
            const call = page.screenshot.mock.calls[0][0] || {};
            expect(call.path).toBeUndefined();
        });

        it('injects overlay then removes it (cleanup asserted)', async () => {
            await service.captureAnnotatedBuffer([{ x: 1 }], { 1: '//button' });
            // evaluate called at least twice: inject + cleanup
            expect(page.evaluate.mock.calls.length).toBeGreaterThanOrEqual(2);
            // last evaluate call must be the cleanup (removes overlay class), matching
            // the disk-sink cleanup contract already covered in AnnotationService.test.js
            const lastCallArgs = page.evaluate.mock.calls[page.evaluate.mock.calls.length - 1];
            expect(lastCallArgs[0].toString()).toMatch(/querySelectorAll/);
        });

        it('returns failure without touching screenshot when no elements resolve', async () => {
            const result = await service.captureAnnotatedBuffer([{ x: 99 }], {});
            expect(result).toEqual({ success: false });
            expect(page.screenshot).not.toHaveBeenCalled();
        });

        it('cleans up overlay even when screenshot throws', async () => {
            page = makePage({ screenshotError: new Error('boom') });
            service = new AnnotationService(page);
            const result = await service.captureAnnotatedBuffer([{ x: 1 }], { 1: '//button' });
            expect(result).toEqual({ success: false });
            expect(page.evaluate).toHaveBeenCalled();
        });
    });

    describe('grid-overlay rendering', () => {
        it('produces R*C labeled cells with cellIds for default 8x8', async () => {
            const cells = await service.renderGrid();
            expect(cells).toHaveLength(64);
            expect(cells[0]).toHaveProperty('ref');
            expect(cells[0]).toHaveProperty('box');
            expect(cells[0]).toHaveProperty('cellId');
            // cellIds unique
            const ids = new Set(cells.map(c => c.cellId));
            expect(ids.size).toBe(64);
        });

        it('reads dims from VISUAL_GRID env (RxC)', async () => {
            process.env.VISUAL_GRID = '2x3';
            const cells = await service.renderGrid();
            // 2 rows x 3 cols = 6 cells
            expect(cells).toHaveLength(6);
        });

        it('cellId format encodes row and column (e.g. r0c0)', async () => {
            process.env.VISUAL_GRID = '2x2';
            const cells = await service.renderGrid();
            expect(cells.map(c => c.cellId).sort()).toEqual(['r0c0', 'r0c1', 'r1c0', 'r1c1']);
        });

        it('cell boxes tile the viewport into equal cells', async () => {
            process.env.VISUAL_GRID = '2x2';
            page = makePage({ viewportSize: { width: 100, height: 200 } });
            service = new AnnotationService(page);
            const cells = await service.renderGrid();
            const first = cells.find(c => c.cellId === 'r0c0');
            expect(first.box).toEqual({ x: 0, y: 0, width: 50, height: 100 });
        });

        it('captureAnnotatedBuffer can render the grid overlay when useGrid=true', async () => {
            process.env.VISUAL_GRID = '2x2';
            const result = await service.captureAnnotatedBuffer([], {}, { useGrid: true });
            expect(result.success).toBe(true);
            expect(Buffer.isBuffer(result.image)).toBe(true);
            expect(result.boxes).toHaveLength(4);
            expect(result.boxes[0]).toHaveProperty('cellId');
        });
    });

    describe('captureAnnotatedScreenshot still writes to the validated path', () => {
        it('still resolves and writes to disk unchanged', async () => {
            const result = await service.captureAnnotatedScreenshot(
                [{ x: 1 }],
                SAFE_PATH,
                { 1: '//button' }
            );
            expect(result).toEqual({
                success: true,
                path: path.resolve(SAFE_PATH),
                boxCount: 1,
            });
            expect(page.screenshot).toHaveBeenCalledWith({
                path: path.resolve(SAFE_PATH),
                fullPage: true,
            });
        });
    });
});
