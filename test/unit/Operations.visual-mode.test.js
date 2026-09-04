/**
 * Unit tests for Operations explicit --mode visual (SPEC vision-mode Unit 3,
 * explicit path only — auto-escalation is a separate task).
 *
 * Mocks VisualRepresenter (represent()) and generateAIResponse — no real
 * browser, no real AI. Verifies:
 *  (a) --mode visual find: represent() -> element markMap; model replies
 *      {mark:"@e2"} -> markMap.get("@e2").element is clicked (existing click
 *      path invoked on that locator).
 *  (b) grid mark: markMap has only a grid entry (bbox+cellId, no element);
 *      model replies {mark:"r0c0"} -> page.mouse.click called at the cell
 *      center (bbox.x + width/2, bbox.y + height/2).
 *  (c) extract-from-image: model reply lands in ops.extracts (verdict
 *      handling unaffected — same sink as text extract).
 *  (d) unknown label {mark:"@e99"} not in markMap -> treated as a visual-find
 *      failure (no matching elements, no crash).
 *  (e) --mode visual + --annotate, ELEMENT path: the marked screenshot
 *      buffer VisualRepresenter already captured is written to disk as the
 *      annotate artifact (fs.promises.writeFile) and recorded via
 *      wsmAdapter.recordArtifact — NOT routed through
 *      captureAnnotatedScreenshot (which cannot resolve a synthetic
 *      {visualMark} descriptor's .x and would silently write nothing).
 *  (f) --mode visual + --annotate, GRID path: same — the marked (grid
 *      overlay) buffer is written to disk and recorded, proving the
 *      grid-fallback + annotate combination produces a real artifact
 *      (this was the review-flagged gap: previously NO artifact at all).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/ai/provider.js');
vi.mock('../../src/cache/CacheManager.js');
vi.mock('../../src/utils/logger.js');
vi.mock('../../src/services/AnnotationService.js');
vi.mock('../../src/VisualRepresenter.js');
vi.mock('../../src/services/WsmAdapter.js', () => ({
    wsmAdapter: {
        recordArtifact: vi.fn().mockResolvedValue(undefined),
        recordToolCall: vi.fn().mockResolvedValue(undefined),
        recordDiagnostics: vi.fn().mockResolvedValue(undefined),
        queryDomainFailureCount: vi.fn().mockResolvedValue(0),
    },
}));
vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        promises: {
            ...actual.promises,
            writeFile: vi.fn().mockResolvedValue(undefined),
        },
    };
});

import { generateAIResponse } from '../../src/ai/provider.js';
import { CacheManager } from '../../src/cache/CacheManager.js';
import { AnnotationService } from '../../src/services/AnnotationService.js';
import { VisualRepresenter } from '../../src/VisualRepresenter.js';
import { wsmAdapter } from '../../src/services/WsmAdapter.js';
import { promises as fsPromises } from 'fs';
import { Operations } from '../../src/Operations.js';

// ── stubs ────────────────────────────────────────────────────────────────

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

let mockRepresent;
VisualRepresenter.mockImplementation(() => ({
    represent: mockRepresent,
}));

function makeLocator() {
    return {
        scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
        count: vi.fn().mockResolvedValue(1),
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
        mouse: { click: vi.fn().mockResolvedValue(undefined) },
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

const IMAGE_BUFFER = Buffer.from('fake-png-bytes');

const TASK = {
    url: 'https://example.com',
    instructions: [],
};

function elementMarkMap(label = '@e2', locator) {
    const m = new Map();
    m.set(label, { element: locator, bbox: { x: 10, y: 20, width: 30, height: 40 } });
    return m;
}

function gridMarkMap(cellId = 'r0c0', bbox = { x: 100, y: 200, width: 50, height: 60 }) {
    const m = new Map();
    m.set(cellId, { bbox, cellId });
    return m;
}

describe('Operations --mode visual (explicit)', () => {
    let page;

    beforeEach(() => {
        vi.clearAllMocks();
        page = makePage();
        mockCaptureAnnotated = vi.fn().mockResolvedValue({ success: true, path: '/tmp/x.png', boxCount: 1 });
        mockRepresent = vi.fn();
        fsPromises.writeFile.mockResolvedValue(undefined);
        wsmAdapter.recordArtifact.mockResolvedValue(undefined);
    });

    describe('(a) element mark resolves to click on markMap element', () => {
        it('clicks the locator resolved from markMap.get(label).element', async () => {
            const targetLocator = makeLocator();
            page.locator.mockReturnValue(targetLocator);

            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: elementMarkMap('@e2', targetLocator),
                strategy: 'elements',
            });

            generateAIResponse.mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'click', prompt: 'the submit button' }],
            });

            expect(mockRepresent).toHaveBeenCalled();
            expect(targetLocator.click).toHaveBeenCalled();
        });
    });

    describe('(b) grid mark clicks the cell center via page.mouse.click', () => {
        it('computes center as bbox.x + width/2, bbox.y + height/2', async () => {
            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: gridMarkMap('r0c0', { x: 100, y: 200, width: 50, height: 60 }),
                strategy: 'grid',
            });

            generateAIResponse.mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: 'r0c0' }])));

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'click', prompt: 'the target cell' }],
            });

            expect(page.mouse.click).toHaveBeenCalledWith(125, 230);
        });
    });

    describe('(c) extract-from-image lands the value in ops.extracts', () => {
        it('parses the visual extract reply into extracts (same sink as text extract)', async () => {
            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: new Map(),
                strategy: 'grid',
            });

            generateAIResponse.mockResolvedValueOnce(
                aiResp(JSON.stringify([{ price: '$19.99' }]))
            );

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'extract', prompt: 'the price shown in the image' }],
            });

            expect(ops.extracts.length).toBeGreaterThan(0);
            expect(ops.extracts.flat()).toContainEqual({ price: '$19.99' });
        });

        it('verdict handling is intact for a visual extract reply', async () => {
            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: new Map(),
                strategy: 'grid',
            });

            generateAIResponse.mockResolvedValueOnce(
                aiResp(JSON.stringify([{ verdict: 'PAGE_OK' }]))
            );

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'extract', prompt: 'report PAGE_OK if the banner is shown in the image' }],
            });

            expect(ops.extracts.flat()).toContainEqual({ verdict: 'PAGE_OK' });
        });
    });

    describe('(d) unknown label not in markMap -> visual-find failure, no crash', () => {
        it('does not throw uncaught and does not click anything', async () => {
            const targetLocator = makeLocator();
            page.locator.mockReturnValue(targetLocator);

            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: elementMarkMap('@e2', targetLocator),
                strategy: 'elements',
            });

            generateAIResponse.mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e99' }])));

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            // Unresolvable mark -> treated as no matching element: action step
            // skips (mirrors "no matching elements found" text-mode behavior),
            // it must not crash the whole run with an uncaught exception.
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'click', prompt: 'something not on screen' }],
            });

            expect(targetLocator.click).not.toHaveBeenCalled();
            expect(page.mouse.click).not.toHaveBeenCalled();
        });
    });

    describe('(g) fill/type/press carry the value the model returned', () => {
        it('fill: locator.fill receives the real value from the visual reply', async () => {
            const targetLocator = makeLocator();
            page.locator.mockReturnValue(targetLocator);

            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: elementMarkMap('@e2', targetLocator),
                strategy: 'elements',
            });

            generateAIResponse.mockResolvedValueOnce(
                aiResp(JSON.stringify([{ mark: '@e2', value: 'user@example.com' }]))
            );

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'fill', prompt: "type 'user@example.com' in the email box" }],
            });

            expect(targetLocator.fill).toHaveBeenCalledWith('user@example.com');
        });

        it('type: locator.type receives the real value from the visual reply', async () => {
            const targetLocator = makeLocator();
            page.locator.mockReturnValue(targetLocator);

            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: elementMarkMap('@e2', targetLocator),
                strategy: 'elements',
            });

            generateAIResponse.mockResolvedValueOnce(
                aiResp(JSON.stringify([{ mark: '@e2', value: 'hello world' }]))
            );

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'type', prompt: "type 'hello world' into the search field" }],
            });

            expect(targetLocator.type).toHaveBeenCalledWith('hello world');
        });

        it('press: locator.press receives the key from the visual reply', async () => {
            const targetLocator = makeLocator();
            page.locator.mockReturnValue(targetLocator);

            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: elementMarkMap('@e2', targetLocator),
                strategy: 'elements',
            });

            generateAIResponse.mockResolvedValueOnce(
                aiResp(JSON.stringify([{ mark: '@e2', value: 'Enter' }]))
            );

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'press', prompt: 'press Enter in the search field' }],
            });

            expect(targetLocator.press).toHaveBeenCalledWith('Enter');
        });

        it('click reply without a value stays valid (no value threaded, click still fires)', async () => {
            const targetLocator = makeLocator();
            page.locator.mockReturnValue(targetLocator);

            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: elementMarkMap('@e2', targetLocator),
                strategy: 'elements',
            });

            generateAIResponse.mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));

            const ops = new Operations(makeCtx(page), { mode: 'visual' });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'click', prompt: 'the submit button' }],
            });

            expect(targetLocator.click).toHaveBeenCalled();
            expect(targetLocator.fill).not.toHaveBeenCalled();
        });
    });

    describe('(e) --mode visual + --annotate coexist (element path)', () => {
        it('writes the captured marked buffer to disk and records the artifact', async () => {
            const targetLocator = makeLocator();
            page.locator.mockReturnValue(targetLocator);

            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: elementMarkMap('@e2', targetLocator),
                strategy: 'elements',
            });

            generateAIResponse.mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: '@e2' }])));

            const ops = new Operations(makeCtx(page), { mode: 'visual', annotate: true });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'click', prompt: 'the submit button' }],
            });

            expect(targetLocator.click).toHaveBeenCalled();
            // NOT routed through captureAnnotatedScreenshot: a synthetic
            // {visualMark} descriptor has no .x, so that path would resolve
            // 0 entries and silently write nothing.
            expect(mockCaptureAnnotated).not.toHaveBeenCalled();
            expect(fsPromises.writeFile).toHaveBeenCalledWith(
                expect.stringMatching(/^\/tmp\/ibr-annotate-step-.*\.png$/),
                IMAGE_BUFFER,
            );
            expect(wsmAdapter.recordArtifact).toHaveBeenCalledWith(
                expect.stringMatching(/^\/tmp\/ibr-annotate-step-/),
                'screenshot',
            );
        });
    });

    describe('(f) --mode visual + --annotate coexist (grid path)', () => {
        it('writes the captured marked grid buffer to disk and records the artifact', async () => {
            mockRepresent.mockResolvedValue({
                image: IMAGE_BUFFER,
                mime: 'image/png',
                markMap: gridMarkMap('r0c0', { x: 100, y: 200, width: 50, height: 60 }),
                strategy: 'grid',
            });

            generateAIResponse.mockResolvedValueOnce(aiResp(JSON.stringify([{ mark: 'r0c0' }])));

            const ops = new Operations(makeCtx(page), { mode: 'visual', annotate: true });
            await ops.executeTask({
                ...TASK,
                instructions: [{ name: 'click', prompt: 'the target cell' }],
            });

            expect(page.mouse.click).toHaveBeenCalledWith(125, 230);
            // The review-flagged gap: previously captureAnnotatedScreenshot
            // resolved 0 boxes for a grid mark and NO artifact was written
            // at all. Now the marked grid buffer is written directly.
            expect(mockCaptureAnnotated).not.toHaveBeenCalled();
            expect(fsPromises.writeFile).toHaveBeenCalledWith(
                expect.stringMatching(/^\/tmp\/ibr-annotate-step-.*\.png$/),
                IMAGE_BUFFER,
            );
            expect(wsmAdapter.recordArtifact).toHaveBeenCalledWith(
                expect.stringMatching(/^\/tmp\/ibr-annotate-step-/),
                'screenshot',
            );
        });
    });
});
