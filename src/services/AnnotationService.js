import path from 'path';
import os from 'os';
import logger from '../utils/logger.js';

const ANNOTATION_CLASS = 'ibr_annotation';
const MAX_CONCURRENT_BBOX = 50;

/**
 * Captures annotated screenshots with bounding-box overlays labeled with
 * element reference IDs (@e1, @e2, @c1, ...).
 *
 * Uses DOM overlay injection via page.evaluate() — no image library dep.
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
     * Capture an annotated screenshot.
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

        // Build locator + ref pairs
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

        if (entries.length === 0) {
            this.logger.warn('AnnotationService: no resolvable elements, skipping screenshot');
            return { success: false };
        }

        const boxes = await this.#fetchBoundingBoxes(entries);

        if (boxes.length === 0) {
            if (entries.length > 0) {
                this.logger.info('AnnotationService: 0 of N elements had resolvable bounding boxes — screenshot will show bare page', { total: entries.length });
            }
            this.logger.warn('AnnotationService: no visible bounding boxes, skipping screenshot');
            return { success: false };
        }

        try {
            // Inject overlay divs
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

            await this.page.screenshot({ path: resolvedPath, fullPage: true });

            this.logger.info('AnnotationService: screenshot captured', {
                path: resolvedPath,
                boxCount: boxes.length,
            });

            return { success: true, path: resolvedPath, boxCount: boxes.length };
        } catch (err) {
            this.logger.warn('AnnotationService: screenshot failed', { error: err.message });
            return { success: false };
        } finally {
            // Always clean up overlays
            await this.page.evaluate((cls) => {
                document.querySelectorAll(`.${cls}`).forEach(el => el.remove());
            }, ANNOTATION_CLASS).catch(() => {});
        }
    }
}
