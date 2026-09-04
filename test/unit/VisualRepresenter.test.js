/**
 * Unit tests for VisualRepresenter (SPEC vision-mode Unit 1).
 *
 * Mocks DomSimplifier (the existing interactive-element probe) and
 * AnnotationService (the Unit-0 shared overlay core) — no real browser,
 * no real DOM. Verifies:
 *   (a) element strategy: N detected elements -> N marks, markMap keyed by
 *       the literal ref/label string the overlay draws on the pixels
 *       (AnnotationService.js label.textContent = ref, e.g. "@e0"), each
 *       {element, bbox}, strategy 'elements', image is a Buffer
 *   (b) grid strategy: detected set empty -> strategy 'grid', markMap keyed
 *       by cell.ref (== cellId, e.g. "r0c0") with cellId + bbox, no element
 *   (c) mark keys are unique and 1:1 with the boxes returned
 *   (d) markMap keys are exactly the drawn ref labels — NOT a synthetic
 *       sequential index — since the model reads the label off the pixels
 *       and replies with it; markMap.get(<that label>) must resolve
 *   (e) overlay cleanup is delegated to the core (asserted via call, not
 *       re-tested — cleanup itself is AnnotationService's tested concern)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger to suppress output
vi.mock('../../src/utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock DomSimplifier — the existing interactive-element probe VisualRepresenter
// reuses (simplify() + injectAttributes() + extractPseudoButtons()).
const mockSimplify = vi.fn();
const mockInjectAttributes = vi.fn().mockResolvedValue(undefined);
const mockExtractPseudoButtons = vi.fn().mockResolvedValue([]);

vi.mock('../../src/DomSimplifier.js', () => ({
    DomSimplifier: vi.fn().mockImplementation(() => ({
        xpaths: [],
        simplify: mockSimplify,
        injectAttributes: mockInjectAttributes,
        extractPseudoButtons: mockExtractPseudoButtons,
    })),
}));

// Mock AnnotationService — the Unit-0 shared overlay core.
const mockCaptureAnnotatedBuffer = vi.fn();
const mockRenderGrid = vi.fn();

vi.mock('../../src/services/AnnotationService.js', () => ({
    AnnotationService: vi.fn().mockImplementation(() => ({
        captureAnnotatedBuffer: mockCaptureAnnotatedBuffer,
        renderGrid: mockRenderGrid,
    })),
}));

import { VisualRepresenter } from '../../src/VisualRepresenter.js';
import { DomSimplifier } from '../../src/DomSimplifier.js';

const IMAGE_BUFFER = Buffer.from('fake-png-bytes');

function makeLocator(box = { x: 0, y: 0, width: 10, height: 10 }) {
    return { boundingBox: vi.fn().mockResolvedValue(box) };
}

function makePage() {
    return {
        locator: vi.fn().mockImplementation(() => makeLocator()),
        evaluate: vi.fn().mockResolvedValue(undefined),
        viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    };
}

/**
 * Build a DomSimplifier-shaped simplified tree ({x,n,t,a,c}) with `count`
 * BUTTON nodes (standard interactive tag) interleaved with DIV nodes, and
 * the parallel xpaths array simplify() would populate. Mirrors the real
 * #simplifyDomTree() output shape so VisualRepresenter's tree-walker is
 * exercised against the actual contract, not an invented shortcut.
 */
function makeSimplifiedTreeWithElements(count) {
    const xpaths = [];
    const children = [];
    for (let i = 0; i < count * 2; i++) {
        xpaths.push(`//node[${i}]`);
        const isInteractive = i % 2 === 0;
        children.push({ x: i, n: isInteractive ? 'BUTTON' : 'DIV', t: '', a: {}, c: [] });
    }
    const tree = { x: -1, n: 'BODY', t: '', a: {}, c: children };
    return { tree, xpaths };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockExtractPseudoButtons.mockResolvedValue([]);
});

describe('VisualRepresenter', () => {
    describe('represent() — element strategy', () => {
        it('produces markMap keyed by the drawn ref labels ("@e0","@e2","@e4") with element+bbox for 3 detected elements, strategy "elements", image is a Buffer', async () => {
            const page = makePage();
            const { tree, xpaths } = makeSimplifiedTreeWithElements(3);

            // simplify() populates the DomSimplifier instance's xpaths and returns
            // a tree with 3 standard interactive elements (BUTTON) at indices 0, 2, 4.
            mockSimplify.mockImplementation(async function () {
                this.xpaths = xpaths;
                return tree;
            });

            const boxes = [
                { ref: '@e0', box: { x: 1, y: 1, width: 10, height: 10 } },
                { ref: '@e2', box: { x: 2, y: 2, width: 10, height: 10 } },
                { ref: '@e4', box: { x: 3, y: 3, width: 10, height: 10 } },
            ];
            mockCaptureAnnotatedBuffer.mockResolvedValue({
                success: true,
                image: IMAGE_BUFFER,
                mime: 'image/png',
                boxes,
            });

            const representer = new VisualRepresenter(page);
            const result = await representer.represent(page);

            expect(result.strategy).toBe('elements');
            expect(Buffer.isBuffer(result.image)).toBe(true);
            expect(result.mime).toBe('image/png');
            expect(result.markMap).toBeInstanceOf(Map);
            expect(result.markMap.size).toBe(3);
            // Keys are the literal ref strings the overlay drew on the pixels
            // (label.textContent = ref in AnnotationService), NOT 1..N.
            expect([...result.markMap.keys()].sort()).toEqual(['@e0', '@e2', '@e4']);

            for (const key of ['@e0', '@e2', '@e4']) {
                const mark = result.markMap.get(key);
                expect(mark).toHaveProperty('element');
                expect(mark).toHaveProperty('bbox');
                expect(mark.cellId).toBeUndefined();
            }
            // bbox matches the boxes returned by the core, keyed by ref
            expect(result.markMap.get('@e0').bbox).toEqual(boxes[0].box);
            expect(result.markMap.get('@e4').bbox).toEqual(boxes[2].box);

            // core was invoked with the detected element descriptors + xpaths
            expect(mockCaptureAnnotatedBuffer).toHaveBeenCalledTimes(1);
            const [calledElements] = mockCaptureAnnotatedBuffer.mock.calls[0];
            expect(calledElements).toHaveLength(3);
        });
    });

    describe('represent() — grid strategy (fallback)', () => {
        it('falls back to grid when the detected element set is empty: strategy "grid", markMap keyed by cellId ("r0c0","r0c1"), cells have cellId+bbox, no element', async () => {
            const page = makePage();

            mockSimplify.mockImplementation(async function () {
                this.xpaths = []; // nothing detected
                return { x: -1, n: 'BODY', t: '', a: {}, c: [] };
            });
            mockExtractPseudoButtons.mockResolvedValue([]);

            const cells = [
                { ref: 'r0c0', box: { x: 0, y: 0, width: 160, height: 90 }, cellId: 'r0c0' },
                { ref: 'r0c1', box: { x: 160, y: 0, width: 160, height: 90 }, cellId: 'r0c1' },
            ];
            mockRenderGrid.mockResolvedValue(cells);
            mockCaptureAnnotatedBuffer.mockResolvedValue({
                success: true,
                image: IMAGE_BUFFER,
                mime: 'image/png',
                boxes: cells,
            });

            const representer = new VisualRepresenter(page);
            const result = await representer.represent(page);

            expect(result.strategy).toBe('grid');
            expect(Buffer.isBuffer(result.image)).toBe(true);
            expect(result.markMap.size).toBe(2);
            // Keys are the literal cell ref/cellId the overlay drew, NOT 1..N.
            expect([...result.markMap.keys()].sort()).toEqual(['r0c0', 'r0c1']);

            for (const [key, mark] of result.markMap) {
                expect(typeof key).toBe('string');
                expect(mark.element).toBeUndefined();
                expect(mark).toHaveProperty('cellId');
                expect(mark).toHaveProperty('bbox');
            }
            expect(result.markMap.get('r0c0').cellId).toBe('r0c0');
            expect(result.markMap.get('r0c1').cellId).toBe('r0c1');

            // Grid capture path used (useGrid), not the element path
            expect(mockCaptureAnnotatedBuffer).toHaveBeenCalledTimes(1);
            const [, , opts] = mockCaptureAnnotatedBuffer.mock.calls[0];
            expect(opts).toMatchObject({ useGrid: true });
        });
    });

    describe('mark key invariants', () => {
        it('mark keys are unique and 1:1 with the boxes returned by the core', async () => {
            const page = makePage();
            const { tree, xpaths } = makeSimplifiedTreeWithElements(4);
            mockSimplify.mockImplementation(async function () {
                this.xpaths = xpaths;
                return tree;
            });

            const boxes = [0, 2, 4, 6].map((i, idx) => ({
                ref: `@e${i}`,
                box: { x: idx, y: idx, width: 5, height: 5 },
            }));
            mockCaptureAnnotatedBuffer.mockResolvedValue({
                success: true,
                image: IMAGE_BUFFER,
                mime: 'image/png',
                boxes,
            });

            const representer = new VisualRepresenter(page);
            const result = await representer.represent(page);

            const keys = [...result.markMap.keys()];
            expect(new Set(keys).size).toBe(keys.length); // unique
            expect(keys.length).toBe(boxes.length); // 1:1
        });
    });

    describe('markMap key === drawn ref label (cross-task integration contract)', () => {
        // AnnotationService.js does `label.textContent = ref` when injecting the
        // overlay — the ref string is what actually appears on the screenshot
        // pixels. The model reads that label off the image and replies with it
        // (Unit 2/3), so markMap MUST be keyed by that same string, not a
        // synthetic sequential index the model never sees. This is the exact
        // seam the cross-task integration review flagged: VisualRepresenter's
        // own tests mock AnnotationService and so never observed the real
        // drawn label unless asserted explicitly, as done here.
        it('element path: every box.ref the core returns is a markMap key, and it resolves the SAME entry', async () => {
            const page = makePage();
            const { tree, xpaths } = makeSimplifiedTreeWithElements(3);
            mockSimplify.mockImplementation(async function () {
                this.xpaths = xpaths;
                return tree;
            });

            const boxes = [
                { ref: '@e0', box: { x: 1, y: 1, width: 10, height: 10 } },
                { ref: '@e2', box: { x: 2, y: 2, width: 10, height: 10 } },
                { ref: '@e4', box: { x: 3, y: 3, width: 10, height: 10 } },
            ];
            mockCaptureAnnotatedBuffer.mockResolvedValue({
                success: true,
                image: IMAGE_BUFFER,
                mime: 'image/png',
                boxes,
            });

            const representer = new VisualRepresenter(page);
            const result = await representer.represent(page);

            for (const entry of boxes) {
                // The label drawn on the pixels (entry.ref) must be usable
                // verbatim as a markMap key — this is what a model reply of
                // e.g. "@e2" resolves against.
                expect(result.markMap.has(entry.ref)).toBe(true);
                expect(result.markMap.get(entry.ref).bbox).toEqual(entry.box);
            }
            // No leftover synthetic-index keys (1, 2, 3, ...) alongside the ref keys.
            expect([...result.markMap.keys()]).toEqual(boxes.map(b => b.ref));
        });

        it('grid path: every cell.ref (== cellId) the core returns is a markMap key, and it resolves the SAME cell', async () => {
            const page = makePage();
            mockSimplify.mockImplementation(async function () {
                this.xpaths = [];
                return { x: -1, n: 'BODY', t: '', a: {}, c: [] };
            });
            mockExtractPseudoButtons.mockResolvedValue([]);

            const cells = [
                { ref: 'r0c0', box: { x: 0, y: 0, width: 160, height: 90 }, cellId: 'r0c0' },
                { ref: 'r0c1', box: { x: 160, y: 0, width: 160, height: 90 }, cellId: 'r0c1' },
                { ref: 'r1c0', box: { x: 0, y: 90, width: 160, height: 90 }, cellId: 'r1c0' },
            ];
            mockRenderGrid.mockResolvedValue(cells);
            mockCaptureAnnotatedBuffer.mockResolvedValue({
                success: true,
                image: IMAGE_BUFFER,
                mime: 'image/png',
                boxes: cells,
            });

            const representer = new VisualRepresenter(page);
            const result = await representer.represent(page);

            for (const cell of cells) {
                expect(result.markMap.has(cell.ref)).toBe(true);
                const mark = result.markMap.get(cell.ref);
                expect(mark.bbox).toEqual(cell.box);
                expect(mark.cellId).toBe(cell.ref);
            }
            expect([...result.markMap.keys()]).toEqual(cells.map(c => c.ref));
        });
    });

    describe('overlay lifecycle delegation', () => {
        it('delegates capture (inject->screenshot->cleanup) to the AnnotationService core rather than managing overlay itself', async () => {
            const page = makePage();
            mockSimplify.mockImplementation(async function () {
                this.xpaths = ['//button[1]'];
                return { x: -1, n: 'BODY', t: '', a: {}, c: [{ x: 0, n: 'BUTTON', t: '', a: {}, c: [] }] };
            });
            mockCaptureAnnotatedBuffer.mockResolvedValue({
                success: true,
                image: IMAGE_BUFFER,
                mime: 'image/png',
                boxes: [{ ref: '@e0', box: { x: 0, y: 0, width: 1, height: 1 } }],
            });

            const representer = new VisualRepresenter(page);
            await representer.represent(page);

            // VisualRepresenter itself never calls page.evaluate directly for
            // overlay injection/removal — that stays inside AnnotationService.
            expect(mockCaptureAnnotatedBuffer).toHaveBeenCalledTimes(1);
        });
    });

    describe('DomSimplifier reuse', () => {
        it('constructs DomSimplifier against the given page (reuses the existing detector, does not reimplement one)', async () => {
            const page = makePage();
            mockSimplify.mockImplementation(async function () {
                this.xpaths = [];
                return { x: -1, n: 'BODY', t: '', a: {}, c: [] };
            });
            mockRenderGrid.mockResolvedValue([]);
            mockCaptureAnnotatedBuffer.mockResolvedValue({
                success: true,
                image: IMAGE_BUFFER,
                mime: 'image/png',
                boxes: [],
            });

            const representer = new VisualRepresenter(page);
            await representer.represent(page);

            expect(DomSimplifier).toHaveBeenCalledWith(page);
            expect(mockSimplify).toHaveBeenCalled();
        });
    });

    describe('capture failure (captureAnnotatedBuffer returns success:false)', () => {
        it('element path: throws a RUNTIME_ERROR CliError rather than downgrading to strategy "grid"', async () => {
            const page = makePage();
            const { tree, xpaths } = makeSimplifiedTreeWithElements(2);
            mockSimplify.mockImplementation(async function () {
                this.xpaths = xpaths;
                return tree;
            });
            // Elements WERE detected, but the core's capture (e.g. screenshot) failed.
            mockCaptureAnnotatedBuffer.mockResolvedValue({ success: false });

            const representer = new VisualRepresenter(page);

            await expect(representer.represent(page)).rejects.toMatchObject({
                name: 'CliError',
                code: 'RUNTIME_ERROR',
            });

            // Capture failure must not silently become the grid path: renderGrid
            // (the grid-specific dimension computation) must never be consulted
            // when elements were the detected strategy.
            expect(mockRenderGrid).not.toHaveBeenCalled();
            // Only the one (failed) element-path capture call was made — no
            // second useGrid:true call as a fallback.
            expect(mockCaptureAnnotatedBuffer).toHaveBeenCalledTimes(1);
        });

        it('grid path: throws a RUNTIME_ERROR CliError rather than returning {image: undefined, ...}', async () => {
            const page = makePage();
            mockSimplify.mockImplementation(async function () {
                this.xpaths = [];
                return { x: -1, n: 'BODY', t: '', a: {}, c: [] };
            });
            mockCaptureAnnotatedBuffer.mockResolvedValue({ success: false });

            const representer = new VisualRepresenter(page);

            await expect(representer.represent(page)).rejects.toMatchObject({
                name: 'CliError',
                code: 'RUNTIME_ERROR',
            });
        });
    });
});
