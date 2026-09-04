import path from 'path';
import os from 'os';
import logger from '../utils/logger.js';

const ANNOTATION_CLASS = 'ibr_annotation';
const MAX_CONCURRENT_BBOX = 50;
const DEFAULT_GRID = '8x8';

/**
 * Shared overlay core: captures screenshots with bounding-box overlays
 * labeled with element reference IDs (@e1, @e2, @c1, ...), or a uniform
 * labeled grid when no elements are resolvable.
 *
 * Uses DOM overlay injection via page.evaluate() — no image library dep.
 * One inject→screenshot→cleanup path backs two sinks:
 *   - captureAnnotatedScreenshot: writes to disk (used by --annotate)
 *   - captureAnnotatedBuffer: returns an in-memory Buffer (used by vision mode)
 */
export class AnnotationService {
    /**
     * @param {import('playwright').Page} page
     * @param {import('../utils/logger.js').default} [log]
     */
    constructor(page, log = logger) {
        this.page = page;
        this.logger = log;
    }

    /**
     * Validate screenshot path is within /tmp or cwd.
     * @param {string} screenshotPath
     * @returns {string} resolved path
     */
    #validatePath(screenshotPath) {
        const resolved = path.resolve(screenshotPath);
        const safeDirs = ['/tmp', os.tmpdir(), process.cwd()];
        const safe = safeDirs.some(
            dir => resolved === dir || resolved.startsWith(dir + path.sep)
        );
        if (!safe) {
            throw new Error(`Screenshot path must be within: ${safeDirs.join(', ')}`);
        }
        return resolved;
    }

    /**
     * Resolve element descriptors + xpaths into locator/ref entries.
     * @param {Array<{x: number|string}>} elements
     * @param {string[] | Record<string|number, string>} xpaths
     * @returns {Array<{locator: import('playwright').Locator, ref: string}>}
     */
    #resolveEntries(elements, xpaths) {
        const entries = [];
        for (const descriptor of (elements || [])) {
            const elementIndex = descriptor.x;
            const isPseudoRef = elementIndex != null && typeof elementIndex === 'string' && elementIndex.startsWith('c');
            const refLabel = isPseudoRef ? `@${elementIndex}` : `@e${elementIndex}`;

            let locator;
            if (isPseudoRef) {
                locator = this.page.locator(`[data-ibr-ref="${elementIndex}"]`);
            } else {
                const xpath = xpaths[elementIndex];
                if (xpath) {
                    locator = this.page.locator(`xpath=${xpath}`);
                } else {
                    this.logger.debug('AnnotationService: no xpath for element', { elementIndex });
                    continue;
                }
            }
            entries.push({ locator, ref: refLabel });
        }
        return entries;
    }

    /**
     * Fetch bounding boxes for elements in batches of MAX_CONCURRENT_BBOX.
     * @param {Array<{locator: import('playwright').Locator, ref: string}>} entries
     * @returns {Promise<Array<{ref: string, box: Object}>>}
     */
    async #fetchBoundingBoxes(entries) {
        const boxes = [];
        for (let i = 0; i < entries.length; i += MAX_CONCURRENT_BBOX) {
            const batch = entries.slice(i, i + MAX_CONCURRENT_BBOX);
            const results = await Promise.all(
                batch.map(async ({ locator, ref }) => {
                    try {
                        const box = await locator.boundingBox({ timeout: 1000 });
                        return box ? { ref, box } : null;
                    } catch {
                        // off-screen or hidden — skip
                        return null;
                    }
                })
            );
            for (const r of results) {
                if (r) boxes.push(r);
            }
        }
        return boxes;
    }

    /**
     * Parse VISUAL_GRID env ('RxC', default 8x8) into {rows, cols}.
     * @returns {{rows: number, cols: number}}
     */
    #gridDims() {
        const raw = process.env.VISUAL_GRID || DEFAULT_GRID;
        const m = /^(\d+)x(\d+)$/i.exec(raw.trim());
        if (!m) {
            this.logger.warn('AnnotationService: invalid VISUAL_GRID, using default', { raw });
            const [rows, cols] = DEFAULT_GRID.split('x').map(Number);
            return { rows, cols };
        }
        return { rows: parseInt(m[1], 10), cols: parseInt(m[2], 10) };
    }

    /**
     * Build a uniform R×C grid of labeled cell boxes tiling the viewport.
     * @returns {Promise<Array<{ref: string, box: {x:number,y:number,width:number,height:number}, cellId: string}>>}
     */
    async renderGrid() {
        const { rows, cols } = this.#gridDims();
        const viewport = (this.page.viewportSize && this.page.viewportSize())
            || { width: 1280, height: 720 };
        const cellWidth = viewport.width / cols;
        const cellHeight = viewport.height / rows;

        const cells = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cellId = `r${r}c${c}`;
                cells.push({
                    ref: cellId,
                    box: {
                        x: c * cellWidth,
                        y: r * cellHeight,
                        width: cellWidth,
                        height: cellHeight,
                    },
                    cellId,
                });
            }
        }
        return cells;
    }

    /**
     * Inject labeled bounding-box overlay divs into the page.
     * @param {Array<{ref: string, box: Object}>} boxes
     */
    async #injectOverlay(boxes) {
        await this.page.evaluate(({ boxes, cls }) => {
            for (const { ref, box } of boxes) {
                const overlay = document.createElement('div');
                overlay.className = cls;
                overlay.style.cssText = [
                    'position:absolute',
                    `top:${box.y}px`,
                    `left:${box.x}px`,
                    `width:${box.width}px`,
                    `height:${box.height}px`,
                    'border:2px solid red',
                    'background:rgba(255,0,0,0.1)',
                    'pointer-events:none',
                    'z-index:99999',
                ].join(';');
                const label = document.createElement('span');
                label.textContent = ref;
                label.style.cssText = [
                    'position:absolute',
                    'top:-14px',
                    'left:0',
                    'background:red',
                    'color:white',
                    'font-size:10px',
                    'padding:0 3px',
                ].join(';');
                overlay.appendChild(label);
                document.body.appendChild(overlay);
            }
        }, { boxes, cls: ANNOTATION_CLASS });
    }

    /**
     * Remove all injected overlay elements. Never throws.
     */
    async #removeOverlay() {
        await this.page.evaluate((cls) => {
            document.querySelectorAll(`.${cls}`).forEach(el => el.remove());
        }, ANNOTATION_CLASS).catch(() => {});
    }

    /**
     * Shared inject→screenshot→cleanup path. `takeScreenshot` decides the
     * sink (disk path vs in-memory buffer); everything else — overlay
     * injection, error handling, cleanup — is identical for both sinks.
     * @param {Array<{ref: string, box: Object}>} boxes
     * @param {() => Promise<any>} takeScreenshot
     * @returns {Promise<{ok: boolean, result?: any}>}
     */
    async #withOverlay(boxes, takeScreenshot) {
        try {
            await this.#injectOverlay(boxes);
            const result = await takeScreenshot();
            return { ok: true, result };
        } catch (err) {
            this.logger.warn('AnnotationService: screenshot failed', { error: err.message });
            return { ok: false };
        } finally {
            await this.#removeOverlay();
        }
    }

    /**
     * Resolve elements (or grid cells) into overlay boxes ready to inject.
     * @param {Array<{x: number|string}>} elements
     * @param {string[] | Record<string|number, string>} xpaths
     * @param {{useGrid?: boolean}} [opts]
     * @returns {Promise<Array<{ref: string, box: Object, cellId?: string}>|null>} null when nothing resolvable
     */
    async #resolveBoxes(elements, xpaths, opts = {}) {
        if (opts.useGrid) {
            return this.renderGrid();
        }

        const entries = this.#resolveEntries(elements, xpaths);
        if (entries.length === 0) {
            this.logger.warn('AnnotationService: no resolvable elements, skipping screenshot');
            return null;
        }

        const boxes = await this.#fetchBoundingBoxes(entries);
        if (boxes.length === 0) {
            this.logger.info('AnnotationService: 0 of N elements had resolvable bounding boxes — screenshot will show bare page', { total: entries.length });
            this.logger.warn('AnnotationService: no visible bounding boxes, skipping screenshot');
            return null;
        }
        return boxes;
    }

    /**
     * Capture an annotated screenshot to disk (--annotate sink).
     *
     * @param {Array<{x: number|string}>} elements - element descriptors from AI response
     * @param {string} screenshotPath - output path (must be /tmp or cwd)
     * @param {string[] | Record<string|number, string>} xpaths - map from element index → xpath string
     * @returns {Promise<{success: boolean, path?: string, boxCount?: number}>}
     */
    async captureAnnotatedScreenshot(elements, screenshotPath, xpaths = {}) {
        let resolvedPath;
        try {
            resolvedPath = this.#validatePath(screenshotPath);
        } catch (err) {
            this.logger.warn('AnnotationService: invalid path', { error: err.message });
            return { success: false };
        }

        const boxes = await this.#resolveBoxes(elements, xpaths);
        if (!boxes) {
            return { success: false };
        }

        const { ok } = await this.#withOverlay(boxes, () =>
            this.page.screenshot({ path: resolvedPath, fullPage: true })
        );

        if (!ok) {
            return { success: false };
        }

        this.logger.info('AnnotationService: screenshot captured', {
            path: resolvedPath,
            boxCount: boxes.length,
        });

        return { success: true, path: resolvedPath, boxCount: boxes.length };
    }

    /**
     * Capture an annotated screenshot in-memory (vision-mode sink). Same
     * inject→screenshot→cleanup path as captureAnnotatedScreenshot; the only
     * difference is page.screenshot() with no path, returning a Buffer.
     *
     * @param {Array<{x: number|string}>} elements
     * @param {string[] | Record<string|number, string>} xpaths
     * @param {{useGrid?: boolean}} [opts] - when useGrid is true, overlays the
     *   uniform labeled grid instead of resolving elements (fallback strategy).
     * @returns {Promise<{success: boolean, image?: Buffer, mime?: string, boxes?: Array<{ref: string, box: Object, cellId?: string}>}>}
     */
    async captureAnnotatedBuffer(elements, xpaths = {}, opts = {}) {
        const boxes = await this.#resolveBoxes(elements, xpaths, opts);
        if (!boxes) {
            return { success: false };
        }

        const { ok, result } = await this.#withOverlay(boxes, () =>
            this.page.screenshot()
        );

        if (!ok) {
            return { success: false };
        }

        this.logger.info('AnnotationService: buffer captured', {
            boxCount: boxes.length,
        });

        return { success: true, image: result, mime: 'image/png', boxes };
    }

    /**
     * Dedupe target for snap.js's former takeAnnotatedScreenshot: outlines
     * elements resolved from a flat xpath list (no numbered labels) and
     * screenshots the viewport (fullPage: false). Preserves snap `-a`'s
     * exact visual output — same DOM/CSS injection and screenshot call,
     * relocated into the shared overlay core.
     *
     * @param {string[]} xpaths - flat list of xpaths to outline
     * @param {string} screenshotPath - output path (no safety validation —
     *   matches snap.js's prior behavior, caller controls the path)
     */
    async captureOutlinedScreenshot(xpaths, screenshotPath) {
        await this.page.evaluate((paths) => {
            const style = document.createElement('style');
            style.id = '__ibr_overlay_style';
            style.textContent = `
      .__ibr_annotated {
        outline: 2px solid rgba(255, 80, 0, 0.8) !important;
        position: relative;
      }
    `;
            document.head.appendChild(style);

            const byXPath = (xpath) => {
                try {
                    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
                        .singleNodeValue;
                } catch (_) {
                    return null;
                }
            };

            for (const xpath of paths) {
                const el = byXPath(xpath);
                if (el && el instanceof HTMLElement) {
                    el.classList.add('__ibr_annotated');
                }
            }
        }, xpaths);

        await this.page.screenshot({ path: screenshotPath, fullPage: false });

        await this.page.evaluate(() => {
            document.getElementById('__ibr_overlay_style')?.remove();
            for (const el of document.querySelectorAll('.__ibr_annotated')) {
                el.classList.remove('__ibr_annotated');
            }
        });
    }
}
