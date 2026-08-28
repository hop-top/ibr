import { DomSimplifier } from './DomSimplifier.js';
import { AnnotationService } from './services/AnnotationService.js';
import { STANDARD_INTERACTIVE_TAGS } from './utils/constants.js';
import logger from './utils/logger.js';
import { CliError } from './utils/cliErrors.js';

/**
 * VisualRepresenter — produces a Set-of-Marks screenshot + a mark→target map
 * for the current page (vision-mode Unit 1).
 *
 * Reuses two existing pieces rather than reimplementing detection or overlay:
 *   - DomSimplifier (src/DomSimplifier.js): the same interactive-element probe
 *     Operations.js's dom-mode #getPageContext() runs — simplify() walks the
 *     DOM assigning each node an xpath index and tags STANDARD_INTERACTIVE_TAGS
 *     nodes, injectAttributes() marks them live with data-ibr-ref, and
 *     extractPseudoButtons() finds cursor-interactive non-standard elements.
 *   - AnnotationService (src/services/AnnotationService.js, Unit 0): the shared
 *     overlay core. captureAnnotatedBuffer() injects numbered boxes, screenshots
 *     in-memory, and cleans up; renderGrid() computes the uniform-grid fallback
 *     cells. VisualRepresenter does not touch page.evaluate() or
 *     page.screenshot() directly — all overlay lifecycle is delegated there.
 *
 * Coordinate space: AnnotationService resolves boxes via Playwright
 * `locator.boundingBox()`, which reports CSS pixels in the page's viewport
 * coordinate space — the same space `page.mouse.click(x, y)` and
 * `locator.click()` use. That box is stored in markMap verbatim (no scaling),
 * so marks are click-ready regardless of devicePixelRatio: boundingBox()
 * already reports CSS px, never physical/screenshot px, so no DPR conversion
 * is needed here. Grid cells are computed from `page.viewportSize()`, which is
 * also CSS pixels, so both strategies share one coordinate space.
 */
export class VisualRepresenter {
    /**
     * @param {import('playwright').Page} page
     * @param {import('../utils/logger.js').default} [log]
     */
    constructor(page, log = logger) {
        this.page = page;
        this.logger = log;
        this.annotationService = new AnnotationService(page, log);
    }

    /**
     * Walk a DomSimplifier-simplified tree, collecting {x, tag} descriptors
     * for every node tagged as a standard interactive element.
     * @param {Object} node
     * @param {Array<{x:number}>} acc
     */
    #collectInteractiveDescriptors(node, acc = []) {
        if (!node) return acc;
        if (STANDARD_INTERACTIVE_TAGS.includes(node.n)) {
            acc.push({ x: node.x });
        }
        if (Array.isArray(node.c)) {
            for (const child of node.c) this.#collectInteractiveDescriptors(child, acc);
        }
        return acc;
    }

    /**
     * Gather the interactive-element set ibr already detects (reused, not
     * reimplemented): standard tags via DomSimplifier.simplify() +
     * pseudo-interactive elements via DomSimplifier.extractPseudoButtons().
     * @param {import('playwright').Page} page
     * @returns {Promise<{elements: Array<{x:number|string}>, xpaths: Record<number,string>}>}
     */
    async #detectInteractiveElements(page) {
        const domSimplifier = new DomSimplifier(page);
        const tree = await domSimplifier.simplify();
        await domSimplifier.injectAttributes(page, domSimplifier.xpaths);

        const elements = this.#collectInteractiveDescriptors(tree);
        const xpaths = { ...domSimplifier.xpaths };

        const pseudoButtons = await domSimplifier.extractPseudoButtons(page);
        if (pseudoButtons.length > 0) {
            await page.evaluate((buttons) => {
                buttons.forEach((btn, i) => {
                    try {
                        const el = document.querySelector(btn.selector);
                        if (el) el.setAttribute('data-ibr-ref', `c${i + 1}`);
                    } catch {
                        // skip individual failures
                    }
                });
            }, pseudoButtons);
            pseudoButtons.forEach((_btn, i) => {
                elements.push({ x: `c${i + 1}` });
            });
        }

        return { elements, xpaths };
    }

    /**
     * Produce a marked screenshot + mark→target map for the current page.
     *
     * @param {import('playwright').Page} page
     * @param {{interactiveOnly?: boolean}} [_opts] - reserved; interactiveOnly
     *   defaults true (this iteration only supports the interactive-element
     *   set — no non-interactive element marking).
     * @returns {Promise<{image: Buffer, mime: string, markMap: Map<number, Object>, strategy: 'elements'|'grid'}>}
     */
    async represent(page, _opts = {}) {
        const targetPage = page || this.page;
        const { elements, xpaths } = await this.#detectInteractiveElements(targetPage);

        if (elements.length > 0) {
            return this.#representElements(targetPage, elements, xpaths);
        }
        return this.#representGrid();
    }

    /**
     * Element strategy (primary): capture the marked screenshot for the
     * detected interactive elements and build markMap keyed by 1-based mark
     * number, matching the numbered labels drawn on the overlay.
     */
    async #representElements(page, elements, xpaths) {
        const captured = await this.annotationService.captureAnnotatedBuffer(elements, xpaths);

        if (!captured.success) {
            // Capture failure (e.g. screenshot threw) is NOT the same condition
            // as "no elements detected" — elements WERE found here, so this must
            // never silently reclassify as strategy:'grid'. Fail loudly instead
            // of returning a malformed {image: undefined, ...} shape (per spec
            // Error handling: screenshot/overlay failure -> RUNTIME_ERROR).
            this.logger.warn('VisualRepresenter: element capture failed');
            throw new CliError(
                'RUNTIME_ERROR',
                `VisualRepresenter: failed to capture annotated screenshot for ${elements.length} detected element(s)`
            );
        }

        const markMap = new Map();
        captured.boxes.forEach((entry, idx) => {
            const mark = idx + 1;
            const refStr = entry.ref.replace(/^@/, '');
            const locator = refStr.startsWith('c')
                ? page.locator(`[data-ibr-ref="${refStr}"]`)
                : page.locator(`xpath=${xpaths[refStr.replace(/^e/, '')]}`);
            markMap.set(mark, { element: locator, bbox: entry.box });
        });

        return {
            image: captured.image,
            mime: captured.mime,
            markMap,
            strategy: 'elements',
        };
    }

    /**
     * Grid strategy (fallback): no interactive elements detected — overlay
     * the uniform labeled grid (Unit-0 core) and map cells with no element.
     */
    async #representGrid() {
        const captured = await this.annotationService.captureAnnotatedBuffer([], {}, { useGrid: true });

        if (!captured.success) {
            // Same rule as the element path: never return a malformed shape
            // (image:Buffer is not optional in the documented contract) and
            // never paper over the failure silently.
            this.logger.warn('VisualRepresenter: grid capture failed');
            throw new CliError(
                'RUNTIME_ERROR',
                'VisualRepresenter: failed to capture annotated grid-overlay screenshot'
            );
        }

        const markMap = new Map();
        captured.boxes.forEach((cell, idx) => {
            markMap.set(idx + 1, { bbox: cell.box, cellId: cell.cellId });
        });

        return {
            image: captured.image,
            mime: captured.mime,
            markMap,
            strategy: 'grid',
        };
    }
}

export default VisualRepresenter;
