import {
    makeTaskDescriptionMessage,
    makeFindInstructionMessage,
    makeFindInstructionWithDiffMessage,
    makeActionInstructionMessage,
    makeExtractInstructionMessage,
    makeFindInstructionMessageDom,
    makeActionInstructionMessageDom,
    makeExtractInstructionMessageDom,
    makeVisualFindMessage,
    makeVisualExtractMessage,
} from "./utils/prompts.js";
import { DomSimplifier } from './DomSimplifier.js';
import { VisualRepresenter } from './VisualRepresenter.js';
import { promises as fsPromises } from 'fs';
import readline from 'readline';
import { SnapshotDiffer } from './utils/SnapshotDiffer.js';
import { getSnapshot, resolveElement, selectMode } from './utils/ariaSimplifier.js';
import { INSTRUCTION_EXECUTION_DELAY_MS, INSTRUCTION_EXECUTION_JITTER_MS, PAGE_LOADING_DELAY_MS, DIALOG_AUTO_ACCEPT, DIALOG_BUFFER_CAPACITY, DIALOG_DEFAULT_PROMPT_TEXT } from "./utils/constants.js";
import { DialogManager } from './DialogManager.js';
import { generateAIResponse } from './ai/provider.js';
import { validateTaskDescription, validateAndParseJSON, createParseErrorMessage, createErrorContext } from './utils/validation.js';
import { parseTaskDescriptionResponse, parseFindElementsResponse, parseActionInstructionResponse, parseExtractionResponse } from './ai/baml-parser.js';
import { CacheManager } from './cache/CacheManager.js';
import { createDomSignature, isDomCompatible, getValidator, extractSchema } from './cache/CacheUtils.js';
import logger from './utils/logger.js';
import { ObservabilityBuffer } from './observability/ObservabilityBuffer.js';
import { ProgressFeedback } from './observability/ProgressFeedback.js';
import { AnnotationService } from './services/AnnotationService.js';
import { streamer } from './observability/NdjsonStreamer.js';
import { wsmAdapter } from './services/WsmAdapter.js';
import { augmentationEngine } from './services/AugmentationEngine.js';
import { HealingService } from './services/HealingService.js';
import { infraManager } from './browser/resolvers/InfraManager.js';
import { CliError, ensureCliError } from './utils/cliErrors.js';

/**
 * Action types the visual (Set-of-Marks) path can actually perform against a
 * resolved mark. `scroll` is deliberately absent: a page-level scroll needs
 * no element at all (the action reply's `no_element_needed` outcome keeps it
 * off this path in the first place), and there is no coherent "scroll to
 * this mark" semantics — scrolling to whatever the vision model guessed, or
 * wheel-scrolling at a grid cell, are both a DIFFERENT action from the one
 * asked for. Anything not listed here is REFUSED with a structured
 * UNSUPPORTED_VISUAL_ACTION error — never silently downgraded to a click,
 * and never silently skipped.
 */
const VISUAL_ACTION_TYPES = new Set(['click', 'fill', 'type', 'press']);

/** Sentinel action type for an instruction the visual path must not perform. */
const VISUAL_UNSUPPORTED_ACTION = 'unsupported';

/** Strip query params from URL before emitting to NDJSON stream (avoid leaking tokens/keys). */
function sanitizeUrlForStream(rawUrl) {
    try {
        const u = new URL(rawUrl);
        return `${u.origin}${u.pathname}`;
    } catch {
        return rawUrl;
    }
}

export class Operations {
    /**
     * @param {Object} ctx - The context object
     * @param {Object} ctx.aiProvider - The AI provider instance
     * @param {Page} ctx.page - The Playwright page instance
     * @param {Object} options - Configuration options
     * @param {number} options.temperature - AI temperature (0-2, default: 0)
     * @param {'aria'|'dom'|'auto'} [options.mode='auto'] - Page context mode
     */
    constructor(ctx, options = {}) {
        this.ctx = ctx;
        this.domSimplifier = new DomSimplifier(ctx.page);
        this.extracts = [];
        this.cacheManager = new CacheManager();
        this.pseudoButtonRefs = {};
        this.snapshotDiffer = new SnapshotDiffer();
        this.observabilityBuffer = new ObservabilityBuffer();
        this._requestStartTimes = new WeakMap();
        this.annotationService = new AnnotationService(ctx.page);
        this.visualRepresenter = new VisualRepresenter(ctx.page);
        // Cache of the current instruction's visual representation, so
        // find + extract within ONE instruction reuse a single screenshot
        // instead of capturing twice (spec Unit 3: "reuse image for
        // find+extract if both run"). Reset at the top of each top-level
        // instruction dispatch (#executeInstruction).
        this._visualRepresentation = null;
        this.annotateMode = !!options.annotate;
        this.ignoreAugmentations = !!options.ignoreAugmentations;
        this.augmentationEngine = augmentationEngine;
        this.healingService = new HealingService(this);
        this.dialogManager = new DialogManager(ctx.page, {
            autoAccept: DIALOG_AUTO_ACCEPT,
            defaultPromptText: DIALOG_DEFAULT_PROMPT_TEXT,
            bufferCapacity: DIALOG_BUFFER_CAPACITY,
        });
        this.dialogManager.init();

        // Popup fallback state (listener attached by caller after page is set)
        this._pendingPopup = null;
        this._originalPage = null;

        // Attach observability listeners
        const page = ctx.page;
        this._onConsole = (msg) => this.observabilityBuffer.addConsoleLog(msg.type(), msg.text());
        this._onRequest = (req) => {
            this._requestStartTimes.set(req, Date.now());
            this.observabilityBuffer.addNetworkRequest(req.method(), req.url());
        };
        this._onResponse = (res) => {
            const req = res.request();
            let duration = null;
            if (req) {
                const startTime = this._requestStartTimes.get(req);
                if (typeof startTime === 'number') {
                    duration = Date.now() - startTime;
                }
            }
            this.observabilityBuffer.matchNetworkResponse(res.url(), res.status(), duration);
        };
        if (page?.on) {
            page.on('console', this._onConsole);
            page.on('request', this._onRequest);
            page.on('response', this._onResponse);
        }

        // Improved token tracking
        this.tokenUsage = {
            prompt: 0,
            completion: 0,
            total: 0
        };

        // Configuration
        this.temperature = Math.min(2, Math.max(0, options.temperature ?? 0));
        this.mode = options.mode ?? 'auto';
        this.quiet = !!options.quiet;
        this.executionIndex = 0;

        // Auto-mode visual-escalation cap (SPEC Unit 3, auto path): read
        // once at construction, per-run counter. Explicit --mode visual
        // never consults this — the cap gates only escalation FROM
        // aria/dom text find/act failures in --mode auto.
        this.visualMaxEscalations = Operations.#parseVisualMaxEscalations(process.env.VISUAL_MAX_ESCALATIONS);
        this._visualEscalationsUsed = 0;

        // Absorbed auto-escalation failures, in execution order. An
        // escalation error is deliberately swallowed so the run falls
        // through to healing (see #attemptVisualEscalation) — which means a
        // genuine fault would otherwise leave no trace a machine consumer
        // can read, since logger.warn reaches the log sink only. This is the
        // result-side half of that record; the NDJSON
        // `visual.escalation_failed` event is the real-time half. Read
        // alongside `extracts` / `tokenUsage`; empty on a clean run.
        this.visualEscalationFailures = [];

        logger.debug('Operations initialized', {
            provider: ctx.aiProvider.provider,
            model: ctx.aiProvider.model,
            temperature: this.temperature,
            mode: this.mode,
            annotate: this.annotateMode,
            options
        });
    }

    /**
     * Parse VISUAL_MAX_ESCALATIONS (default 3). Any non-positive-integer
     * value (missing, non-numeric, zero, negative) falls back to the
     * default rather than disabling/broadening the cap silently.
     * @param {string|undefined} raw
     * @returns {number}
     */
    static #parseVisualMaxEscalations(raw) {
        const DEFAULT_CAP = 3;
        if (raw == null || raw === '') return DEFAULT_CAP;
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP;
    }

    /**
     * Update token usage tracking
     * @param {Object} usage - Usage object with promptTokens, completionTokens
     */
    #updateTokenUsage(usage) {
        this.tokenUsage.prompt += usage.promptTokens || 0;
        this.tokenUsage.completion += usage.completionTokens || 0;
        this.tokenUsage.total += (usage.promptTokens || 0) + (usage.completionTokens || 0);
    }

    async #executeInstruction(instruction) {
        switch (instruction.name) {
            case 'loop':
                return await this.#loopInstruction(instruction);
            case 'condition':
                return await this.#conditionInstruction(instruction);
            case 'extract':
                return await this.#extractInstruction(instruction);
            case 'click':
            case 'fill':
            case 'type':
            case 'press':
            case 'scroll':
                return await this.#actionInstruction(instruction);
            case 'wait_for_human':
                return await this.#waitForHumanInstruction(instruction);
            case 'wait':
                return await this.#waitInstruction(instruction);
            default:
                throw new Error(
                    `Unknown instruction type: "${instruction.name}". ` +
                    `Supported types: loop, condition, extract, click, fill, type, press, scroll. ` +
                    `Check the task description returned by parseTaskDescription() and ensure each instruction uses a valid "name" field.`
                );
        }
    }

    /**
     * On strict mode violation, extract disambiguating text from
     * the instruction prompt and scope the locator to a parent
     * element containing that text.
     *
     * Example: "click delete next to jad+rami@ideacrafters.com"
     * → finds row containing "jad+rami@ideacrafters.com"
     * → scopes getByRole('link', { name: 'delete' }) to that row
     */
    async #scopeByPromptContext(descriptor, prompt) {
        // Extract potential scoping text: email addresses, quoted
        // strings, or text after "next to" / "near" / "for" / "of"
        const patterns = [
            /[\w.+]+@[\w.-]+/,                    // email
            /"([^"]+)"/,                           // quoted string
            /(?:next to|near|for|of|beside)\s+(.+?)(?:\s*$)/i,
        ];
        let scopeText = null;
        for (const pat of patterns) {
            const m = prompt.match(pat);
            if (m) { scopeText = m[1] || m[0]; break; }
        }
        if (!scopeText) return null;

        const page = this.ctx.page;
        const { role, name } = descriptor;
        if (!role || !name) return null;

        // Scope: find the nearest ancestor row/cell/group that
        // contains both the scope text and the target element.
        // Walk up from the text node through ancestor selectors.
        const ancestors = ['tr', 'row', 'li', 'div', 'td', 'section'];
        const textLocator = page.getByText(scopeText, { exact: false });

        for (const ancestor of ancestors) {
            // [1] = nearest ancestor of this type (not the outermost)
            const parent = textLocator.locator(`xpath=ancestor::${ancestor}[1]`);
            const scoped = parent.getByRole(role, { name }).first();
            try {
                const count = await scoped.count();
                if (count > 0) return scoped;
            } catch {
                continue;
            }
        }

        // Fallback: walk up parent chain until we find the target
        let walker = textLocator;
        for (let i = 0; i < 6; i++) {
            walker = walker.locator('..');
            const scoped = walker.getByRole(role, { name }).first();
            try {
                const count = await scoped.count();
                if (count > 0) return scoped;
            } catch {
                continue;
            }
        }
        return null;
    }

    #switchToPage(page) {
        this.ctx.page = page;
        this.domSimplifier = new DomSimplifier(page);
        this.annotationService = new AnnotationService(page);
        // Same staleness the constructor guards against (see index.js's
        // post-launch page patch): visualRepresenter owns its OWN
        // AnnotationService instance, so a page switch (popup) must refresh
        // it too, or a visual capture after switching throws reading
        // .locator on the pre-switch page.
        this.visualRepresenter.page = page;
        this.visualRepresenter.annotationService.page = page;
        this.dialogManager = new DialogManager(page, {
            autoAccept: DIALOG_AUTO_ACCEPT,
            defaultPromptText: DIALOG_DEFAULT_PROMPT_TEXT,
            bufferCapacity: DIALOG_BUFFER_CAPACITY,
        });
        this.dialogManager.init();
        this.snapshotDiffer.reset();
    }

    #getCurrentPageUrl() {
        const pageUrl = this.ctx?.page?.url;
        if (typeof pageUrl === 'function') {
            try {
                const resolved = pageUrl.call(this.ctx.page);
                if (typeof resolved === 'string' && resolved.length > 0) {
                    return resolved;
                }
            } catch (error) {
                logger.debug('Failed to read current page url', { error: error.message });
            }
        }

        return typeof this.url === 'string' && this.url.length > 0 ? this.url : null;
    }

    async #executeInstructions(instructions) {
        for (const instruction of instructions) {
            this.executionIndex++;
            await this.#executeInstruction(instruction);
        }
    }

    /**
     * Top-level instruction loop with long-run progress feedback.
     * Advances the progress reporter once per top-level instruction (n/N).
     * Nested instruction lists (condition/loop bodies) run through
     * #executeInstructions and deliberately do NOT advance progress, so the
     * n/N count tracks the user-authored instruction list, not the expanded
     * execution tree.
     * @param {Array} instructions
     * @param {ProgressFeedback} progress
     */
    async #executeTopLevelInstructions(instructions, progress) {
        for (const instruction of instructions) {
            this.executionIndex++;
            progress.advance(instruction);
            await this.#executeInstruction(instruction);
        }
    }

    async executeTask(taskDescription) {
        this.executionIndex = 0;
        logger.info('Executing task', {
            url: taskDescription.url,
            instructionCount: taskDescription.instructions.length
        });

        const taskStartMs = Date.now();
        streamer.taskStart({ prompt: taskDescription.url });

        // Long-run progress feedback (kit/progress + kit/stream). N is known
        // now; advance per top-level instruction; render to stderr only.
        const progress = new ProgressFeedback({
            total: taskDescription.instructions.length,
            quiet: this.quiet,
        });

        // Initialize cache, augmentation engine and infra manager
        await this.cacheManager.init();
        await this.augmentationEngine.init();
        await this.healingService.init();
        await infraManager.init();
        this.url = taskDescription.url;

        // Reset observability buffer; set page origin for cross-origin detection
        try {
            this.observabilityBuffer.pageOriginHost = new URL(taskDescription.url).host;
        } catch {
            this.observabilityBuffer.pageOriginHost = null;
        }
        this.observabilityBuffer.clear();
        this.dialogManager.clear();

        // Re-attach listeners each task (they were removed in the previous finally)
        const page = this.ctx.page;
        if (page?.on) {
            page.on('console', this._onConsole);
            page.on('request', this._onRequest);
            page.on('response', this._onResponse);
        }

        try {
            // WSM pre-flight: warn if domain has prior failures in workspace history
            const priorFailures = await wsmAdapter.queryDomainFailureCount(taskDescription.url);
            if (priorFailures > 0) {
                logger.warn('WSM pre-flight: prior failures detected at this domain', {
                    url: sanitizeUrlForStream(taskDescription.url),
                    priorFailures,
                });
            }

            const reusePage = process.env.BROWSER_REUSE_PAGE?.toLowerCase() === 'true';
            const skipNav = reusePage && taskDescription.url === 'current';
            this.snapshotDiffer.reset();
            const navStart = Date.now();
            try {
                if (skipNav) {
                    logger.debug('Reusing current page', { url: this.ctx.page.url() });
                } else {
                    logger.debug('Navigating to URL', { url: taskDescription.url });
                    await this.ctx.page.goto(taskDescription.url, { waitUntil: 'networkidle' });
                }
                streamer.navigation({ url: sanitizeUrlForStream(taskDescription.url), status: 'success' });
                // WSM: record successful navigation
                await wsmAdapter.recordToolCall(
                    'navigate',
                    { url: sanitizeUrlForStream(taskDescription.url) },
                    { status: 'success' },
                    Date.now() - navStart,
                );
            } catch (err) {
                streamer.navigation({ url: sanitizeUrlForStream(taskDescription.url), status: 'error', error: err.message });
                // WSM: record navigation failure
                await wsmAdapter.recordToolCall(
                    'navigate',
                    { url: sanitizeUrlForStream(taskDescription.url) },
                    { status: 'error', error: err.message },
                    Date.now() - navStart,
                );
                throw err;
            }
            await this.#waitJitteredDelay(PAGE_LOADING_DELAY_MS);

            logger.debug('Preparing page');
            await this.#preparePage();

            logger.info('Starting instruction execution', {
                count: taskDescription.instructions.length
            });
            await this.#executeTopLevelInstructions(taskDescription.instructions, progress);

            progress.finish('task complete');
            logger.info('Task execution completed successfully');
            streamer.taskEnd({ startMs: taskStartMs, status: 'success' });
        } catch (error) {
            progress.fail('task failed');
            logger.error('Task execution failed', {
                url: taskDescription.url,
                executionIndex: this.executionIndex,
                error: error.message
            });
            streamer.taskEnd({ startMs: taskStartMs, status: 'error', error: error.message });
            // WSM: persist diagnostic buffer on failure for auditing
            const diagText = this.observabilityBuffer.flush();
            await wsmAdapter.recordDiagnostics(diagText, sanitizeUrlForStream(taskDescription.url));
            throw error;
        } finally {
            const page = this.ctx.page;
            if (page?.off) {
                page.off('console', this._onConsole);
                page.off('request', this._onRequest);
                page.off('response', this._onResponse);
            }
        }
    }

    async parseTaskDescription(text) {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error(
                'Task description cannot be empty. ' +
                'Pass a non-empty string prompt, e.g.: "url: https://example.com\\ninstructions:\\n  - click the login button"'
            );
        }

        logger.info('Parsing task description', {
            inputLength: text.length,
            preview: text.substring(0, 100)
        });

        const messages = makeTaskDescriptionMessage(text);

        try {
            const response = await generateAIResponse(
                this.ctx.aiProvider.modelInstance,
                messages,
                { temperature: 0 }
            );

            this.#updateTokenUsage(response.usage);

            const output = response.content?.trim();
            if (!output) {
                throw new Error(
                    'AI model returned an empty response while parsing the task description. ' +
                    'Verify AI_PROVIDER and the corresponding API key are set correctly. ' +
                    'If the prompt is very short, try adding more context about the target URL and desired actions.'
                );
            }

            let taskDescription;
            try {
                taskDescription = validateAndParseJSON(output, 'Task description parsing');
            } catch (parseErr) {
                logger.error(createParseErrorMessage('task description', output, parseErr));
                throw parseErr;
            }

            // Validate structure
            validateTaskDescription(taskDescription);

            logger.info('Task description parsed successfully', {
                url: taskDescription.url,
                instructionCount: taskDescription.instructions.length,
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens
            });

            return taskDescription;
        } catch (error) {
            logger.error('Task description parsing failed', {
                error: error.message,
                stage: 'parseTaskDescription'
            });
            throw error;
        }
    }

    async #conditionInstruction(instruction) {
        const context = createErrorContext('condition instruction', {
            instructionIndex: this.executionIndex
        });

        logger.info(`${context}: ${instruction.prompt}`);

        try {
            await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
            const { isAria } = await this.#getPageContext();
            const elements = await this.#findElements(instruction.prompt);

            if (elements.length > 0) {
                logger.debug(`${context}: Condition TRUE, executing success path`, {
                    elementCount: elements.length,
                    successInstructions: instruction.success_instructions?.length || 0
                });
                await this.#executeInstructions(instruction.success_instructions);
            } else {
                logger.debug(`${context}: Condition FALSE, executing failure path`, {
                    failureInstructions: instruction.failure_instructions?.length || 0
                });
                await this.#executeInstructions(instruction.failure_instructions);
            }

            logger.info(`${context} completed`);

            // --annotate mode: capture screenshot after condition evaluation
            if (this.annotateMode && elements?.length > 0) {
                const shotPath = `/tmp/ibr-annotate-step-${this.executionIndex}-${Date.now()}.png`;
                await this.annotationService.captureAnnotatedScreenshot(
                    elements || [],
                    shotPath,
                    isAria ? null : this.domSimplifier.xpaths
                ).catch(() => {}); // non-fatal
                // WSM: record artifact
                await wsmAdapter.recordArtifact(shotPath, 'screenshot').catch(() => {});
            }
        } catch (error) {
            const alreadyAnnotated = error.message.includes('--- observability ---');
            const obs = alreadyAnnotated ? '' : this.observabilityBuffer.flush();
            const errMsg = alreadyAnnotated
                ? error.message
                : `${error.message}\n--- observability ---\n${obs}`;
            logger.error(`${context} failed`, {
                error: errMsg,
                executionIndex: this.executionIndex
            });
            throw alreadyAnnotated
                ? error
                : ensureCliError(error, 'RUNTIME_ERROR', { message: errMsg });
        }
    }

    async #loopInstruction(instruction) {
        const context = createErrorContext('loop instruction', {
            instructionIndex: this.executionIndex
        });

        logger.info(`${context}: ${instruction.prompt}`);

        try {
            let iterationCount = 0;
            const maxIterations = 100; // Safety limit

            while (iterationCount < maxIterations) {
                await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
                const elements = await this.#findElements(instruction.prompt);

                if (elements.length > 0) {
                    iterationCount++;
                    logger.debug(`${context}: Iteration ${iterationCount}, condition TRUE, executing loop body`, {
                        elementCount: elements.length,
                        loopInstructions: instruction.instructions?.length || 0
                    });
                    await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
                    await this.#executeInstructions(instruction.instructions);
                } else {
                    logger.debug(`${context}: Condition FALSE, breaking loop`, {
                        totalIterations: iterationCount
                    });
                    break;
                }
            }

            if (iterationCount >= maxIterations) {
                logger.warn(`${context}: Reached maximum iteration limit (${maxIterations}), breaking to prevent infinite loop`);
            }

            logger.info(`${context} completed`, {
                totalIterations: iterationCount
            });
            this.executionIndex++;
        } catch (error) {
            const alreadyAnnotated = error.message.includes('--- observability ---');
            const obs = alreadyAnnotated ? '' : this.observabilityBuffer.flush();
            const errMsg = alreadyAnnotated
                ? error.message
                : `${error.message}\n--- observability ---\n${obs}`;
            logger.error(`${context} failed`, {
                error: errMsg,
                executionIndex: this.executionIndex
            });
            throw alreadyAnnotated
                ? error
                : ensureCliError(error, 'RUNTIME_ERROR', { message: errMsg });
        }
    }

    async #extractInstruction(instruction) {
        const context = createErrorContext('extract instruction', {
            instructionIndex: this.executionIndex,
            instructionName: instruction.name
        });

        logger.info(`${context}: ${instruction.prompt}`);

        try {
            await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);

            this.#resetVisualRepresentation();

            let extract;
            let response;

            if (this.mode === 'visual') {
                // --mode visual: extract-from-image (SPEC Unit 3). Same sink
                // (this.extracts) and same parse/verdict handling as the text
                // path — only the source representation differs.
                logger.debug('Sending visual extract instruction to AI', {
                    promptLength: instruction.prompt.length,
                });
                const visualResult = await this.#resolveVisualExtract(instruction.prompt);
                extract = visualResult.extract;
                response = { usage: visualResult.usage };
            } else {
                const { context: pageContext, isAria } = await this.#getPageContext();

                // Note: For extraction, we always call AI for fresh data
                // Caching would require re-extracting from current DOM
                const makeExtract = isAria ? makeExtractInstructionMessage : makeExtractInstructionMessageDom;
                const messages = makeExtract(instruction.prompt, pageContext);

                logger.debug('Sending extract instruction to AI', {
                    promptLength: instruction.prompt.length,
                    contextLength: pageContext.length
                });

                response = await generateAIResponse(
                    this.ctx.aiProvider.modelInstance,
                    messages,
                    { temperature: this.temperature }
                );

                const output = response.content?.trim();

                try {
                    if (output) {
                      const parsed = parseExtractionResponse(output);
                      extract = Array.isArray(parsed) ? parsed : [parsed];
                    } else {
                      extract = [];
                    }
                } catch (parseErr) {
                    logger.warn(createParseErrorMessage('extraction', output, parseErr));
                    extract = [];
                }
            }

            this.#updateTokenUsage(response.usage);

            this.extracts.push(extract);

            // Emit one NDJSON event per extracted field
            // extract is already an array (parseExtractionResponse normalises it above)
            for (const item of extract) {
                if (item && typeof item === 'object') {
                    for (const [field, value] of Object.entries(item)) {
                        const safeValue = (value !== null && typeof value === 'object') ? String(value) : value;
                        streamer.extract({ field, value: safeValue, status: 'success' });
                    }
                }
            }

            // WSM: record extract result in workspace timeline
            if (extract.length > 0) {
                const totalFields = extract.reduce(
                    (sum, item) => item && typeof item === 'object'
                        ? sum + Object.keys(item).length
                        : sum,
                    0,
                );
                await wsmAdapter.recordToolCall(
                    'extract',
                    { prompt: instruction.prompt },
                    { status: 'success', fields: totalFields },
                    0,
                );
            }

            logger.info(`${context} completed`, {
                extractedFields: Object.keys(extract).length,
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens
            });

            // --annotate mode: capture screenshot of page during extraction
            if (this.annotateMode) {
                const shotPath = `/tmp/ibr-annotate-step-${this.executionIndex}-${Date.now()}.png`;
                await this.ctx.page.screenshot({ path: shotPath }).catch(() => {}); // non-fatal
                // WSM: record artifact
                await wsmAdapter.recordArtifact(shotPath, 'screenshot').catch(() => {});
            }
        } catch (error) {
            const alreadyAnnotated = error.message.includes('--- observability ---');
            const obs = alreadyAnnotated ? '' : this.observabilityBuffer.flush();
            const errMsg = alreadyAnnotated
                ? error.message
                : `${error.message}\n--- observability ---\n${obs}`;
            logger.error(`${context} failed`, {
                error: errMsg,
                executionIndex: this.executionIndex
            });
            streamer.instructionError({ instructionType: 'extract', error: error.message });
            throw alreadyAnnotated
                ? error
                : ensureCliError(error, 'RUNTIME_ERROR', { message: errMsg });
        }
    }

    async #actionInstruction(instruction) {
        const context = createErrorContext('action instruction', {
            instructionIndex: this.executionIndex,
            instructionName: instruction.name
        });

        logger.info(`${context}: ${instruction.prompt}`);

        let action;
        const actionStartMs = Date.now();
        try {
            await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);

            this.#resetVisualRepresentation();

            // Preemptive popup switch: if a popup opened after a
            // previous action, switch to it before trying to find
            // elements. The user's next instruction likely targets
            // the popup, not the original page.
            if (this._pendingPopup) {
                const popup = this._pendingPopup;
                this._pendingPopup = null;
                this._originalPage = this.ctx.page;
                logger.info(`${context}: Switching to popup before action`, {
                    popupUrl: popup.url(),
                });
                this.#switchToPage(popup);
                popup.on('close', () => {
                    if (this._originalPage) {
                        logger.debug('Popup closed, returning to original page');
                        this.#switchToPage(this._originalPage);
                        this._originalPage = null;
                    }
                });
            }

            let isAria = false;

            if (this.mode === 'visual') {
                // --mode visual: resolve the action via Set-of-Marks instead
                // of aria/dom text (SPEC Unit 3, explicit path). No cache —
                // visual calls always re-capture, mirroring the extract path.
                logger.debug('Sending visual action instruction to AI', {
                    promptLength: instruction.prompt.length,
                });
                action = await this.#resolveVisualAction(instruction);
            } else {
                const { context: pageContext, isAria: ariaFlag } = await this.#getPageContext();
                isAria = ariaFlag;
                const domSignature = createDomSignature(pageContext);

                // Check cache first
                const cacheKey = this.cacheManager.generateKey(this.url, instruction.prompt, 'action');
                const cached = await this.cacheManager.get('action', cacheKey);

                if (cached && isDomCompatible(cached.metadata.lastDomSignature, domSignature)) {
                    try {
                        // Try to apply cached schema (ARIA descriptors)
                        const { elementDescriptors, actionType, actionValue } = cached.schema;
                        if (elementDescriptors && elementDescriptors.length > 0) {
                            action = {
                                elements: elementDescriptors,
                                type: actionType,
                                value: actionValue
                            };
                            await this.cacheManager.recordSuccess('action', cacheKey);
                            logger.info(`${context} completed (CACHE HIT)`, { actionType });
                        }
                    } catch (error) {
                        logger.debug('Cache application failed', { error: error.message });
                        await this.cacheManager.recordFailure('action', cacheKey);
                        action = null;
                    }
                }

                // Cache miss or invalid - call AI
                if (!action) {
                    const makeAction = isAria ? makeActionInstructionMessage : makeActionInstructionMessageDom;
                    const messages = makeAction(instruction.prompt, pageContext);

                    logger.debug('Sending action instruction to AI', {
                        promptLength: instruction.prompt.length,
                        contextLength: pageContext.length,
                        isAria
                    });

                    const response = await generateAIResponse(
                        this.ctx.aiProvider.modelInstance,
                        messages,
                        { temperature: this.temperature }
                    );

                    this.#updateTokenUsage(response.usage);

                    const output = response.content?.trim();

                    try {
                        action = output ? parseActionInstructionResponse(output) : { elements: [] };
                    } catch (parseErr) {
                        logger.warn(createParseErrorMessage('action', output, parseErr));
                        action = { elements: [] };
                    }

                    logger.debug(`${context} parsed`, {
                        actionType: action.type,
                        elementCount: action.elements?.length || 0,
                        promptTokens: response.usage.promptTokens,
                        completionTokens: response.usage.completionTokens
                    });

                    // Cache successful result
                    if (action.elements && action.elements.length > 0) {
                        const schema = extractSchema('action', action);
                        await this.cacheManager.set('action', cacheKey, {
                            schema,
                            metadata: { lastDomSignature: domSignature }
                        });
                    }
                }
            }

            if (action && action.elements && action.elements.length > 0) {
                const descriptor = action.elements[0];
                const elementRef = descriptor.x;
                const refStr = elementRef != null ? String(elementRef).replace(/^@/, '') : '';

                let locator;
                let locatorDesc;
                if (action.visual) {
                    // --mode visual resolution: either the element locator
                    // markMap resolved directly, or (grid strategy) no
                    // element — act on the cell centre via mouse/keyboard.
                    //
                    // Belt-and-braces on the refusal contract: a mark whose
                    // action type the visual path cannot perform is refused
                    // HERE, outside the performAction try/catch below, so
                    // the structured UNSUPPORTED_VISUAL_ACTION reaches the
                    // caller intact instead of being rewrapped as a
                    // RUNTIME_ERROR and sent through healing.
                    // #resolveVisualAction already refuses these up front,
                    // so this guard is unreachable via that route — it keeps
                    // the invariant local to where the action is executed.
                    if (!VISUAL_ACTION_TYPES.has(action.type?.toLowerCase())) {
                        throw this.#unsupportedVisualAction(
                            action.type?.toLowerCase() ?? instruction.name,
                            'a visual mark',
                        );
                    }
                    if (action.visual.locator) {
                        locator = action.visual.locator;
                        locatorDesc = `visual-mark=${action.visual.label}`;
                    } else {
                        locatorDesc = `visual-grid=${action.visual.label}`;
                        await this.#performVisualGridAction(
                            action.visual.gridCenter,
                            action,
                            action.visual.label,
                        );
                        streamer.action({
                            actionType: action.type || instruction.name,
                            selector: locatorDesc,
                            valueLength: action.value != null ? String(action.value).length : 0,
                            status: 'success',
                        });
                        await wsmAdapter.recordToolCall(
                            action.type || instruction.name,
                            { selector: locatorDesc, prompt: instruction.prompt },
                            { status: 'success' },
                            Date.now() - actionStartMs,
                        );
                        await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
                        this.snapshotDiffer.reset();
                        logger.info(`${context} executed successfully`, { actionType: action.type });

                        if (this.annotateMode) {
                            // Write the marked (grid-overlay) buffer the
                            // model saw — captureAnnotatedScreenshot cannot
                            // do this: it resolves descriptor.x, which a
                            // synthetic visual-mark descriptor never has.
                            await this.#writeVisualAnnotateArtifact();
                        }

                        return;
                    }
                } else if (!isAria && refStr.startsWith('c') && this.pseudoButtonRefs[refStr]) {
                    locator = this.#resolvePseudoButtonRef(refStr);
                    locatorDesc = `data-ibr-ref=${refStr}`;
                } else if (!isAria && refStr) {
                    const xpath = this.domSimplifier.xpaths[elementRef];
                    if (xpath) {
                        locator = this.ctx.page.locator(`xpath=${xpath}`);
                        locatorDesc = `xpath=${xpath}`;
                    } else {
                        locator = resolveElement(this.ctx.page, descriptor);
                        locatorDesc = JSON.stringify(descriptor);
                    }
                } else {
                    locator = resolveElement(this.ctx.page, descriptor);
                    locatorDesc = JSON.stringify(descriptor);
                }

                if (!locator) {
                    throw new CliError(
                        'ELEMENT_NOT_FOUND',
                        `Unable to resolve element descriptor: ${JSON.stringify(descriptor)}. ` +
                        `The AI returned a reference that could not be matched to a page element. ` +
                        `Run "ibr snap <url> -i" to inspect available interactive elements and their @refs, ` +
                        `then retry with a more specific prompt.`,
                        { step: this.executionIndex, action: action.type?.toLowerCase() || instruction.name }
                    );
                }

                try {
                    // Strict mode pre-check: if locator resolves to
                    // multiple elements, scope using prompt context
                    // before attempting scroll or action.
                    const count = await locator.count();
                    if (count > 1 && instruction.prompt) {
                        const scoped = await this.#scopeByPromptContext(descriptor, instruction.prompt);
                        if (scoped) {
                            logger.info(`${context}: Multiple matches (${count}), scoped to prompt context`);
                            locator = scoped;
                            locatorDesc = `scoped(${JSON.stringify(descriptor)})`;
                        }
                    }

                    logger.debug(`Scrolling element into view`, { locator: locatorDesc });
                    await locator.scrollIntoViewIfNeeded();
                    await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);

                    const actionType = action.type?.toLowerCase();
                    const performAction = async () => {
                        switch (actionType) {
                            case 'click':
                                logger.info(`${context}: Clicking element`, { locator: locatorDesc });
                                await locator.click();
                                break;
                            case 'fill':
                                logger.info(`${context}: Filling element with text`, { locator: locatorDesc, valueLength: action.value?.length || 0 });
                                await locator.fill(action.value);
                                break;
                            case 'type':
                                logger.info(`${context}: Typing into element`, { locator: locatorDesc, valueLength: action.value?.length || 0 });
                                await locator.type(action.value);
                                break;
                            case 'press':
                                logger.info(`${context}: Pressing key`, { locator: locatorDesc, key: action.value });
                                await locator.press(action.value);
                                break;
                            default:
                                // No fallthrough to click: performing SOME
                                // other action is strictly worse than
                                // performing none. A visual mark carrying an
                                // unperformable type can no longer reach
                                // here — #resolveVisualAction refuses it up
                                // front (see the guard above this try) — so
                                // this is now only the text path's unknown
                                // type, where an element-scoped scroll is
                                // already satisfied by the
                                // scrollIntoViewIfNeeded above.
                                logger.warn(`${context}: Unknown action type`, { actionType });
                        }
                    };

                    try {
                        await performAction();
                    } catch (actionError) {
                        // Auto-mode escalation ladder (aria->dom->visual,
                        // capped) — SPEC Unit 3 auto path: before reaching
                        // for healing, try a visual (Set-of-Marks) attempt
                        // for THIS instruction. Explicit --mode visual never
                        // reaches this catch via a text-action failure (it
                        // never attempts a text action), so it is naturally
                        // excluded — the cap only ever gates this branch.
                        if (this.mode === 'auto') {
                            // The failed text action already carries the
                            // value the model resolved from this prose
                            // (fill/type text, press key) — hand it to the
                            // visual retry so it performs the SAME action
                            // with the SAME value, instead of re-asking.
                            const escalatedTo = await this.#attemptVisualEscalation(instruction, 'text find/act failed', action.value);
                            if (escalatedTo) {
                                // Visual attempt resolved AND executed the
                                // action successfully — record success and
                                // skip healing entirely for this instruction.
                                await this.#completeEscalatedAction(context, instruction, action, escalatedTo, actionStartMs);
                                return;
                            }
                        }

                        // Attempt to heal if not already raw/ignored
                        if (!this.ignoreAugmentations) {
                            // SPEC Unit 4: when an auto-escalation visual attempt
                            // ran for THIS instruction (it resolved a mark, then
                            // the action itself still failed — falling through
                            // here), this._visualRepresentation holds the frame
                            // the model just saw. Pass it so healing's hypothesis
                            // is visually grounded. On the pure-text-failure path
                            // (mode !== 'auto', or auto with no escalation attempt)
                            // #resetVisualRepresentation() left this null, so the
                            // call stays the existing 4-arg call — unchanged.
                            const fix = this._visualRepresentation
                                ? await this.healingService.attemptHeal(this.ctx.page, instruction, locator, actionError, {
                                    image: this._visualRepresentation.image,
                                    mime: this._visualRepresentation.mime,
                                    markMap: this._visualRepresentation.markMap,
                                })
                                : await this.healingService.attemptHeal(this.ctx.page, instruction, locator, actionError);
                            if (fix) {
                                if (fix.action === 'switch_provider') {
                                    logger.info(`${context}: Switching infrastructure`, { provider: fix.provider });
                                    // 1. Resolve new infra
                                    const providerRecord = infraManager.resolveProvider(fix.provider);
                                    if (providerRecord) {
                                        // 2. Extract current state (cookies)
                                        const cookies = await this.ctx.page.context().cookies();
                                        
                                        // 3. Teardown current browser
                                        await this.ctx.browserHandle.close();
                                        
                                        // 4. Connect to new infra
                                        // We need resolveBrowser to handle this record kind or similar logic
                                        // Actually, I should update resolveBrowser to support direct record kinds
                                        // But for now, let's assume we can trigger a re-resolve with overrides
                                        const { resolve } = await import('./browser/resolver.js');
                                        const newHandle = await resolve(process.env, { 
                                            // Force the new provider via env override or direct record
                                            BROWSER_CHANNEL: fix.provider
                                        });
                                        
                                        // 5. Restore state
                                        await newHandle.context.addCookies(cookies);
                                        const newPage = await newHandle.context.newPage();
                                        
                                        const resumeUrl = this.#getCurrentPageUrl();

                                        // 6. Update context and resume
                                        this.ctx.browserHandle = newHandle;
                                        this.ctx.page = newPage;
                                        this.annotationService.page = newPage;
                                        this.dialogManager.page = newPage;
                                        this.domSimplifier.page = newPage;
                                        this.visualRepresenter.page = newPage;
                                        this.visualRepresenter.annotationService.page = newPage;

                                        if (resumeUrl) {
                                            await newPage.goto(resumeUrl, { waitUntil: 'networkidle' });
                                        }
                                        
                                        // Re-resolve the locator on the new page
                                        // Note: this assumes descriptor is still valid
                                        locator = resolveElement(newPage, descriptor);
                                        await performAction();
                                        return;
                                    }
                                }

                                await this.augmentationEngine.upsertRule(fix);
                                // Retry action ONCE
                                logger.info(`${context}: Retrying action after successful heal`, { ruleId: fix.id });
                                await performAction();
                            } else {
                                throw actionError;
                            }
                        } else {
                            throw actionError;
                        }
                    }

                    streamer.action({
                        actionType: actionType || instruction.name,
                        selector: locatorDesc,
                        valueLength: action.value != null ? String(action.value).length : 0,
                        status: 'success',
                    });
                    // WSM: record browser action in workspace timeline
                    await wsmAdapter.recordToolCall(
                        actionType || instruction.name,
                        { selector: locatorDesc, prompt: instruction.prompt },
                        { status: 'success' },
                        Date.now() - actionStartMs,
                    );
                    await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
                    // Reset snapshot after action so next #findElements gets fresh diff baseline
                    this.snapshotDiffer.reset();
                    logger.info(`${context} executed successfully`, { actionType });

                    // --annotate mode: capture screenshot after action
                    if (this.annotateMode) {
                        if (action.visual) {
                            // --mode visual: write the already-captured
                            // marked (Set-of-Marks) buffer — a synthetic
                            // {visualMark} descriptor has no descriptor.x,
                            // so captureAnnotatedScreenshot would resolve 0
                            // entries and silently write nothing.
                            await this.#writeVisualAnnotateArtifact();
                        } else {
                            const shotPath = `/tmp/ibr-annotate-step-${this.executionIndex}-${Date.now()}.png`;
                            await this.annotationService.captureAnnotatedScreenshot(
                                action.elements || [],
                                shotPath,
                                isAria ? null : this.domSimplifier.xpaths
                            ).catch(() => {}); // non-fatal
                            // WSM: record artifact
                            await wsmAdapter.recordArtifact(shotPath, 'screenshot').catch(() => {});
                        }
                    }
                } catch (actionError) {
                    logger.error(`${context} execution failed`, {
                        locator: locatorDesc,
                        actionType: action.type,
                        error: actionError.message
                    });
                    streamer.action({
                        actionType: action.type?.toLowerCase() || instruction.name,
                        selector: locatorDesc,
                        valueLength: action.value != null ? String(action.value).length : 0,
                        status: 'error',
                        error: actionError.message,
                    });
                    // WSM: record action failure in workspace timeline
                    await wsmAdapter.recordToolCall(
                        action.type?.toLowerCase() || instruction.name,
                        { selector: locatorDesc, prompt: instruction.prompt },
                        { status: 'error', error: actionError.message },
                        Date.now() - actionStartMs,
                    );
                    throw new CliError(
                        'RUNTIME_ERROR',
                        `Failed to execute "${action.type}" action on element ${locatorDesc}: ${actionError.message}. ` +
                        `The element was found but the action failed — it may be hidden, disabled, or covered by another element. ` +
                        `Run "ibr snap <url> -i" to inspect the page state.`,
                        { step: this.executionIndex, action: action.type?.toLowerCase() || instruction.name, cause: actionError }
                    );
                } finally {
                    // Clean up injected refs after action
                    await this.ctx.page.evaluate(() =>
                        document.querySelectorAll('[data-ibr-ref]').forEach(el => el.removeAttribute('data-ibr-ref'))
                    ).catch(() => {});
                }
            } else {
                // The text find resolved NO elements. That reply shape is
                // ambiguous on its own — it is BOTH "I could not find the
                // target" and "there is nothing to act on" (a page-level
                // scroll, an optional click). Only the model's own
                // `outcome: "not_found"` marks a genuine miss, and only a
                // genuine miss is worth escalating: escalating every empty
                // reply would add a screenshot + vision call to every
                // legitimate no-op step. A reply carrying no outcome at all
                // (every pre-existing caller and cassette) is NOT a miss.
                //
                // A find failure never reaches the performAction catch above,
                // so under --mode auto this is the ladder's second entry
                // point; a resolved+executed visual attempt completes the
                // instruction here. Otherwise (mode not auto, no miss signal,
                // cap spent, visual resolved nothing) it stays the historical
                // skip: there is no locator and no action error for healing
                // to work with.
                const isFindMiss = action?.outcome === 'not_found';
                const escalatedTo = isFindMiss && this.mode === 'auto'
                    ? await this.#attemptVisualEscalation(instruction, 'text find reported not_found')
                    : null;
                if (escalatedTo) {
                    await this.#completeEscalatedAction(context, instruction, action, escalatedTo, actionStartMs);
                    return;
                }
                logger.info(`${context}: No matching elements found, skipping action`, {
                    outcome: action?.outcome ?? 'unspecified',
                });
            }
        } catch (error) {
            // ANNOTATED_SCREENSHOTS_ON_FAILURE: capture screenshot on action failure
            if (process.env.ANNOTATED_SCREENSHOTS_ON_FAILURE === 'true' && action?.elements?.length) {
                const shotPath = `/tmp/ibr-failure-step-${this.executionIndex}-${Date.now()}.png`;
                await this.annotationService.captureAnnotatedScreenshot(
                    action.elements,
                    shotPath,
                    this.domSimplifier.xpaths
                ).catch(() => {}); // non-fatal
                // WSM: persist failure screenshot as artifact for visual evidence
                await wsmAdapter.recordArtifact(shotPath, 'screenshot').catch(() => {});
            }

            const alreadyAnnotated = error.message.includes('--- observability ---');
            const obs = alreadyAnnotated ? '' : this.observabilityBuffer.flush();
            const errMsg = alreadyAnnotated
                ? error.message
                : `${error.message}\n--- observability ---\n${obs}`;
            logger.error(`${context} failed`, {
                error: errMsg,
                executionIndex: this.executionIndex
            });
            throw alreadyAnnotated
                ? error
                : ensureCliError(error, 'RUNTIME_ERROR', { message: errMsg });
        }
    }

    /**
     * Get (or reuse) the current instruction's Set-of-Marks screenshot +
     * markMap for --mode visual (SPEC Unit 3, explicit path).
     *
     * Memoized on this.\_visualRepresentation so repeat calls within ONE
     * instruction return the SAME captured frame — spec: "Construct
     * VisualRepresenter once per instruction, reuse image for find+extract
     * if both run." `#resetVisualRepresentation()` clears the cache at the
     * start of each action/extract instruction handler so a later
     * instruction captures a fresh frame rather than a stale one.
     *
     * @returns {Promise<{image: Buffer, mime: string, markMap: Map<string,Object>, strategy: string}>}
     */
    async #getVisualRepresentation() {
        if (!this._visualRepresentation) {
            this._visualRepresentation = await this.visualRepresenter.represent(this.ctx.page);
        }
        return this._visualRepresentation;
    }

    /** Drop the cached visual representation — call at the start of each instruction. */
    #resetVisualRepresentation() {
        this._visualRepresentation = null;
    }

    /**
     * --mode visual --annotate: write the ALREADY-CAPTURED marked screenshot
     * (this._visualRepresentation.image — the Set-of-Marks/grid overlay
     * buffer VisualRepresenter sent to the model) to disk as the --annotate
     * artifact, instead of routing a synthetic {visualMark}/{gridCenter}
     * descriptor through AnnotationService.captureAnnotatedScreenshot.
     *
     * That would-be alternative resolves descriptor.x (AnnotationService's
     * #resolveEntries), which a visual-mode action descriptor never has —
     * 0 entries resolved -> #resolveBoxes returns null -> {success:false} ->
     * no artifact written at all, silently (caught by .catch(()=>{}) and
     * skipped since success:false never reaches recordArtifact). Writing
     * the buffer we already hold sidesteps that resolution entirely and is
     * also the FRAME the model actually saw (element marks or grid),
     * strictly better than the disk sink's own text-mode capture.
     *
     * Non-fatal: a write/record failure never fails the instruction, same
     * tolerance as the existing --annotate disk paths.
     */
    async #writeVisualAnnotateArtifact() {
        if (!this._visualRepresentation?.image) return;
        const shotPath = `/tmp/ibr-annotate-step-${this.executionIndex}-${Date.now()}.png`;
        try {
            await fsPromises.writeFile(shotPath, this._visualRepresentation.image);
            await wsmAdapter.recordArtifact(shotPath, 'screenshot').catch(() => {});
        } catch {
            // non-fatal — mirrors the .catch(()=>{}) tolerance on the
            // text-mode disk-capture annotate paths
        }
    }

    /**
     * The single visual-refusal error, shared by every path that can refuse
     * one: the pre-resolve short-circuit in #resolveVisualAction and both
     * executors (#performVisualAction, #performVisualGridAction). A refused
     * visual action is ALWAYS this structured error — stderr JSON and a
     * non-zero exit — never a silent skip, so the caller never gets exit 0
     * having had a step quietly dropped.
     *
     * Names the offending action type AND the instruction index, because the
     * caller cannot see which internal strategy the run picked, and states
     * the remedy: a page-level scroll needs no visual resolution, so the
     * non-visual modes perform it directly.
     *
     * @param {string|undefined} actionType
     * @param {string} [surface] where the refusal happened, for the message
     * @returns {CliError}
     */
    #unsupportedVisualAction(actionType, surface = 'the visual (Set-of-Marks) path') {
        const named = actionType ?? 'unknown';
        return new CliError(
            'UNSUPPORTED_VISUAL_ACTION',
            `Instruction ${this.executionIndex} ("${named}") cannot be performed on ${surface}. ` +
            `The visual (Set-of-Marks) path supports ${[...VISUAL_ACTION_TYPES].join(', ')} only. ` +
            `Re-run that instruction with --mode auto (or --mode aria / --mode dom): ` +
            `a page-level scroll needs no element, so it is performed without visual resolution.`,
            { step: this.executionIndex, action: named },
        );
    }

    /**
     * --mode visual find: send the marked screenshot to the model and
     * resolve its {mark:"<label>"} reply against markMap. Returns an
     * `action`-shaped object compatible with #actionInstruction's existing
     * locator-resolution/click machinery via the `visual` field, or an
     * action with an empty `elements` array when the model's reply doesn't
     * resolve (unknown label, empty response, etc.) — mirrors the text-mode
     * "no matching elements found" outcome rather than throwing.
     *
     * fill/type/press need a value, which lives only in the free-form
     * instruction prose — so the visual find prompt asks for an optional
     * "value" alongside the mark (same {type,value} pairing the text action
     * prompt already uses). `fallbackValue` takes precedence when supplied:
     * on the auto-escalation path the failed TEXT action already carries the
     * value the model resolved from the same prose, so the retry reuses it
     * verbatim rather than asking the model a second time.
     *
     * @param {Object} instruction
     * @param {string} [fallbackValue] value from a failed text action, reused
     *   for the visual retry in preference to re-deriving it.
     * An instruction the visual path cannot PERFORM (scroll — see
     * VISUAL_ACTION_TYPES) is REFUSED before the screenshot and vision call:
     * resolving a mark we could only act on wrongly buys nothing but a
     * wasted request. The refusal is a structured UNSUPPORTED_VISUAL_ACTION
     * error, never a silent skip — under explicit --mode visual a user who
     * asked for a scroll must learn it cannot be done there rather than get
     * exit 0 having done nothing. Callers that are NOT an explicit user
     * request for the visual path (auto-escalation) must filter the
     * instruction out before calling this, not catch the refusal.
     *
     * @throws {CliError} UNSUPPORTED_VISUAL_ACTION when the instruction's
     *   action type cannot be performed against a visual mark.
     * @returns {Promise<{elements: Array, type: 'click'|'fill'|'type'|'press'|'unsupported', value?: string, visual?: {locator?: Object, gridCenter?: {x:number,y:number}, label: string}}>}
     */
    async #resolveVisualAction(instruction, fallbackValue) {
        if (!VISUAL_ACTION_TYPES.has(instruction.name)) {
            throw this.#unsupportedVisualAction(instruction.name);
        }

        const { image, mime, markMap } = await this.#getVisualRepresentation();
        const labels = [...markMap.keys()];

        const messages = makeVisualFindMessage(instruction.prompt, labels);
        const response = await generateAIResponse(
            this.ctx.aiProvider.modelInstance,
            messages,
            { temperature: this.temperature, image, mime, provider: this.ctx.aiProvider.provider, model: this.ctx.aiProvider.model }
        );

        this.#updateTokenUsage(response.usage);

        const output = response.content?.trim();
        let found;
        try {
            found = output ? parseFindElementsResponse(output) : [];
        } catch (parseErr) {
            logger.warn(createParseErrorMessage('visual find', output, parseErr));
            found = [];
        }

        // Only the action types the visual path can actually PERFORM map
        // through. Anything else — `scroll` above all — maps to an explicit
        // unsupported marker so the executors refuse it; mapping it to
        // 'click' would make a scroll instruction silently click whatever
        // element the vision model happened to pick.
        const actionType = VISUAL_ACTION_TYPES.has(instruction.name)
            ? instruction.name
            : VISUAL_UNSUPPORTED_ACTION;

        const descriptor = Array.isArray(found) && found.length > 0 ? found[0] : null;
        const label = descriptor?.mark ?? null;
        const mark = label != null ? markMap.get(label) : null;
        // A click reply legitimately omits "value" — keep it undefined then,
        // exactly as the text action path does.
        const value = fallbackValue !== undefined && fallbackValue !== null
            ? fallbackValue
            : (descriptor?.value ?? undefined);

        if (!mark) {
            // Label missing/unparseable/not in markMap: visual-find failure —
            // report as "no matching elements" (same shape #actionInstruction
            // already treats as a no-op skip), never crash.
            if (label != null) {
                logger.warn('Visual find: model returned a label not present in markMap', { label, availableLabels: labels });
            }
            return { elements: [], type: actionType, value };
        }

        return {
            elements: [{ visualMark: label }],
            type: actionType,
            value,
            visual: mark.element
                ? { locator: mark.element, label }
                : { gridCenter: { x: mark.bbox.x + mark.bbox.width / 2, y: mark.bbox.y + mark.bbox.height / 2 }, label },
        };
    }

    /**
     * Auto-mode escalation ladder (aria->dom->visual, capped) — SPEC Unit 3
     * auto path / plan "Operations: auto-escalation ladder". Called from
     * #actionInstruction when this.mode === 'auto' and the normal text
     * (aria/dom) attempt has just failed for this instruction, at either
     * failure point: the find reported a genuine miss (outcome "not_found",
     * no action attempted), or the found element's action threw (BEFORE
     * healingService.attemptHeal).
     *
     * Escalation is PER-INSTRUCTION and capped per run by
     * VISUAL_MAX_ESCALATIONS (this.visualMaxEscalations, read once at
     * construction) — explicit --mode visual never calls this method, so
     * it is unaffected by the cap. Reuses the explicit-visual resolve path
     * (#resolveVisualAction: represent -> visual find ->
     * resolve mark) and, on a resolved mark, performs the SAME action the
     * failed text attempt was trying (click / fill / type / press) via the
     * existing click/mouse machinery.
     *
     * Never escalates silently: emits a 'visual.escalation' event via the
     * NDJSON streamer when an attempt is made, or a 'visual.escalation_capped'
     * note when the cap blocks the attempt.
     *
     * @param {Object} instruction
     * @param {string} [reason] - which failure point triggered the escalation,
     *   carried on the 'visual.escalation' event
     * @param {string} [failedActionValue] the value the failed text action
     *   was going to use (fill/type text, press key). Reused verbatim by the
     *   visual retry so it performs the SAME action with the SAME value.
     * @returns {Promise<string|null>} the executed visual target's
     *   description (`visual-mark=<label>` / `visual-grid=<label>`, the
     *   explicit --mode visual path's locatorDesc convention) when the visual
     *   attempt resolved AND the action executed successfully — the caller
     *   treats the instruction as done and skips healing; null if escalation
     *   was capped, the visual find didn't resolve a mark, or the resolved
     *   visual action itself failed (the caller falls through to its own
     *   failure handling — healing on the act-failure path, the historical
     *   skip on the find-miss path).
     */
    async #attemptVisualEscalation(instruction, reason = 'text find/act failed', failedActionValue) {
        if (!VISUAL_ACTION_TYPES.has(instruction.name)) {
            // A refused visual action is ALWAYS a structured error — but
            // this path must never REACH a refusal, so it filters instead.
            //
            // Escalation is a best-effort last rung of the aria->dom->visual
            // ladder, reached only after the text attempt already failed for
            // this instruction. The user asked for --mode auto, not for a
            // visual attempt, and under auto a page-level scroll is
            // legitimate and must keep working — turning an unperformable
            // type into a thrown error here would abort a run over an
            // internal strategy choice the user never made. Escalating an
            // action the visual rung could not perform is meaningless work,
            // so the instruction is filtered out before the attempt: no
            // screenshot, no vision call, and no escalation budget spent.
            // The caller then falls through to its own handling (healing on
            // the act-failure path, the historical skip on a find miss),
            // exactly as if the visual rung did not exist.
            //
            // The error contract lives on the EXPLICIT path
            // (#resolveVisualAction), which is where the user actually asked
            // for the visual path and so must be told it cannot comply.
            logger.warn('Auto-escalation: action type not performable on a visual mark, skipping visual attempt', {
                instructionIndex: this.executionIndex,
                actionType: instruction.name,
            });
            return null;
        }

        if (this._visualEscalationsUsed >= this.visualMaxEscalations) {
            streamer.visualEscalationCapped({
                instructionIndex: this.executionIndex,
                cap: this.visualMaxEscalations,
            });
            logger.warn('Auto-escalation: VISUAL_MAX_ESCALATIONS reached, skipping visual attempt', {
                instructionIndex: this.executionIndex,
                cap: this.visualMaxEscalations,
            });
            return null;
        }

        this._visualEscalationsUsed += 1;
        streamer.visualEscalation({
            instructionIndex: this.executionIndex,
            reason,
            escalationsUsed: this._visualEscalationsUsed,
            cap: this.visualMaxEscalations,
        });
        logger.info(`Auto-escalation: ${reason}, attempting visual resolution`, {
            instructionIndex: this.executionIndex,
            escalationsUsed: this._visualEscalationsUsed,
            cap: this.visualMaxEscalations,
        });

        let visualAction;
        try {
            visualAction = await this.#resolveVisualAction(instruction, failedActionValue);
        } catch (err) {
            this.#recordEscalationFailure('resolution', err);
            logger.warn('Auto-escalation: visual resolution errored, visual attempt abandoned', { error: err.message });
            return null;
        }

        if (!visualAction?.visual) {
            // Visual find didn't resolve a mark (empty/unknown label) — same
            // "no matching elements" shape #resolveVisualAction already
            // returns for the explicit path. Nothing to execute.
            return null;
        }

        const { locator, gridCenter, label } = visualAction.visual;
        const target = locator ? `visual-mark=${label}` : `visual-grid=${label}`;
        try {
            if (locator) {
                await this.#performVisualAction(locator, visualAction);
            } else {
                await this.#performVisualGridAction(gridCenter, visualAction, label);
            }
        } catch (err) {
            this.#recordEscalationFailure('execution', err, target);
            logger.warn('Auto-escalation: visual action execution failed, visual attempt abandoned', { target, error: err.message });
            return null;
        }

        if (this.annotateMode) {
            await this.#writeVisualAnnotateArtifact();
        }

        return target;
    }

    /**
     * Surface an auto-escalation error that #attemptVisualEscalation
     * absorbs. Control flow is unchanged — the caller still returns null and
     * falls through to healing, which is the deliberate resilience. What
     * this adds is visibility: without it the only trace is a logger.warn on
     * the log sink, so a scripted consumer reading the NDJSON stream or the
     * run result sees a clean run even when a real fault (a detached
     * element, a mid-action navigation, a vision-provider outage, a refused
     * MISSING_ACTION_VALUE) was swallowed.
     *
     * @param {'resolution'|'execution'} phase - the vision call, or acting on the resolved mark
     * @param {Error} err - the absorbed error; `code` is carried when it has one
     * @param {string} [target] - `visual-mark=<label>` / `visual-grid=<label>`, known only in the execution phase
     */
    #recordEscalationFailure(phase, err, target) {
        const record = {
            instructionIndex: this.executionIndex,
            phase,
            error: err?.message ?? String(err),
        };
        if (err?.code) record.code = err.code;
        if (target) record.target = target;

        this.visualEscalationFailures.push(record);
        streamer.visualEscalationFailed(record);
    }

    /**
     * Success bookkeeping for an instruction completed by an auto-escalation
     * visual attempt, shared by both entry points in #actionInstruction (the
     * act-failure catch and the find-miss else branch): emit the action event,
     * record the tool call, then the same post-action settle the text path
     * performs.
     * @param {string} context
     * @param {Object} instruction
     * @param {{type?: string, value?: string}|null} action - parsed text action; carries no usable type on a find miss
     * @param {string} selector - executed visual target, as returned by #attemptVisualEscalation
     * @param {number} actionStartMs
     */
    async #completeEscalatedAction(context, instruction, action, selector, actionStartMs) {
        const actionType = action?.type?.toLowerCase() || instruction.name;
        streamer.action({
            actionType,
            selector,
            valueLength: action?.value != null ? String(action.value).length : 0,
            status: 'success',
        });
        await wsmAdapter.recordToolCall(
            actionType,
            { selector, prompt: instruction.prompt },
            { status: 'success' },
            Date.now() - actionStartMs,
        );
        await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
        this.snapshotDiffer.reset();
        logger.info(`${context}: resolved via auto-escalation to visual`, { actionType, selector });
    }

    /**
     * Execute the resolved action type against a visual-mark locator.
     * Shared by #attemptVisualEscalation (auto path); the explicit --mode
     * visual path performs the same switch inline in #actionInstruction's
     * main flow (its locator additionally goes through the strict-mode
     * scoping / scrollIntoViewIfNeeded steps that don't apply to a
     * last-resort escalation retry).
     * @param {import('playwright').Locator} locator
     * @param {{type: string, value?: string}} action
     */
    async #performVisualAction(locator, action) {
        const actionType = action.type?.toLowerCase();
        switch (actionType) {
            case 'click':
                await locator.click();
                break;
            case 'fill':
                await locator.fill(action.value);
                break;
            case 'type':
                await locator.type(action.value);
                break;
            case 'press':
                await locator.press(action.value);
                break;
            default:
                // Never fall through to a click: performing SOME other
                // action is strictly worse than performing none. `scroll`
                // lands here by design (see VISUAL_ACTION_TYPES).
                throw this.#unsupportedVisualAction(actionType, 'a visual mark');
        }
    }

    /**
     * Execute the resolved action type against a GRID cell centre — the
     * fallback strategy when VisualRepresenter detected no interactive
     * elements (canvas / unlabelled pages). There is no locator here, only a
     * coordinate, so text entry is click-to-focus followed by
     * page.keyboard.type/press rather than locator.fill/type/press.
     *
     * A grid cell is a plausible text target on exactly the pages this
     * strategy exists for, so a fill/type must NOT degrade to a bare click:
     * that silently drops the value the model resolved and reports success.
     * A missing value is refused outright for the same reason.
     *
     * @param {{x: number, y: number}} gridCenter
     * @param {{type: string, value?: string}} action
     * @param {string} label - the grid mark label, for logging
     */
    async #performVisualGridAction(gridCenter, action, label) {
        const { x: cx, y: cy } = gridCenter;
        const actionType = action.type?.toLowerCase();

        if (!VISUAL_ACTION_TYPES.has(actionType)) {
            throw this.#unsupportedVisualAction(actionType, 'a visual grid cell');
        }

        if (actionType !== 'click' && (action.value == null || action.value === '')) {
            throw new CliError(
                'MISSING_ACTION_VALUE',
                `Action type "${actionType}" on visual grid cell ${label} has no value to apply. ` +
                `The grid strategy has no element to inspect, so there is nothing to ${actionType}. ` +
                `Make the instruction state the text or key explicitly (e.g. "type 'hello' into the canvas field").`,
                { step: this.executionIndex, action: actionType },
            );
        }

        logger.info(`Visual grid cell: performing ${actionType}`, {
            label,
            x: cx,
            y: cy,
            valueLength: action.value != null ? String(action.value).length : 0,
        });

        // Focus the cell first — every supported type needs the click, and
        // for click it IS the whole action.
        await this.ctx.page.mouse.click(cx, cy);

        switch (actionType) {
            case 'click':
                break;
            case 'fill':
            case 'type':
                await this.ctx.page.keyboard.type(action.value);
                break;
            case 'press':
                await this.ctx.page.keyboard.press(action.value);
                break;
        }
    }

    /**
     * --mode visual extract-from-image: send the marked screenshot to the
     * model with the extraction prompt; parses identically to the text
     * extract path (verdict handling included) — same sink, same shape.
     *
     * @param {string} userPrompt
     * @returns {Promise<{extract: Array, usage: Object}>}
     */
    async #resolveVisualExtract(userPrompt) {
        const { image, mime } = await this.#getVisualRepresentation();
        const messages = makeVisualExtractMessage(userPrompt);
        const response = await generateAIResponse(
            this.ctx.aiProvider.modelInstance,
            messages,
            { temperature: this.temperature, image, mime, provider: this.ctx.aiProvider.provider, model: this.ctx.aiProvider.model }
        );

        this.#updateTokenUsage(response.usage);

        const output = response.content?.trim();
        let extract;
        try {
            if (output) {
                const parsed = parseExtractionResponse(output);
                extract = Array.isArray(parsed) ? parsed : [parsed];
            } else {
                extract = [];
            }
        } catch (parseErr) {
            logger.warn(createParseErrorMessage('visual extraction', output, parseErr));
            extract = [];
        }

        return { extract, usage: response.usage };
    }

    /**
     * Get page context string for AI.
     * Uses quality-based mode selection (aria/dom) with optional forced mode.
     * Returns {context: string, domTree: Object|null, isAria: boolean}
     */
    async #getPageContext() {
        const url = this.#getCurrentPageUrl();
        const activeRules = url ? this.augmentationEngine.getRulesForUrl(url) : [];

        if (!this.ignoreAugmentations && activeRules.length > 0) {
            const ruleIds = activeRules.map(r => r.id);
            logger.info('Applying augmentations to page', { url, count: activeRules.length, rules: ruleIds });
            await this.ctx.page.evaluate((rules) => {
                rules.forEach(rule => {
                    // 1. DOM Mutations: Remove
                    rule.domMutations?.remove?.forEach(sel => {
                        document.querySelectorAll(sel).forEach(el => el.remove());
                    });

                    // 2. DOM Mutations: Isolate
                    if (rule.domMutations?.isolate?.length > 0) {
                        const targets = rule.domMutations.isolate.flatMap(sel => 
                            Array.from(document.querySelectorAll(sel))
                        );
                        if (targets.length > 0) {
                            // Keep only targets and their ancestors
                            const keep = new Set();
                            targets.forEach(t => {
                                let curr = t;
                                while (curr) {
                                    keep.add(curr);
                                    curr = curr.parentElement;
                                }
                            });
                            const all = document.querySelectorAll('*');
                            all.forEach(el => {
                                if (!keep.has(el) && el.parentElement && el.tagName !== 'HTML' && el.tagName !== 'BODY' && el.tagName !== 'HEAD') {
                                    el.remove();
                                }
                            });
                        }
                    }

                    // 3. DOM Mutations: AddClass
                    rule.domMutations?.addClass?.forEach(({ selector, class: className }) => {
                        document.querySelectorAll(selector).forEach(el => el.classList.add(className));
                    });

                    // 4. Scripting: evaluateBeforeSnapshot
                    if (rule.scripting?.evaluateBeforeSnapshot) {
                        try {
                            // Indirect eval to run in global scope
                            (0, eval)(rule.scripting.evaluateBeforeSnapshot);
                        } catch (err) {
                            console.error(`Augmentation script error [${rule.id}]:`, err.message);
                        }
                    }
                });
            }, activeRules);
        }

        const snapshot = await getSnapshot(this.ctx.page);
        const { mode, reason } = selectMode(snapshot, this.mode);

        if (mode === 'aria') {
            if (typeof snapshot !== 'string') {
                // selectMode should have prevented this via forced-aria-unavailable,
                // but guard defensively in case snapshot is still null.
                logger.warn('aria mode selected but snapshot is null, falling back to dom', { reason });
            } else {
                logger.info('using aria mode', { reason });
                return { context: snapshot, domTree: null, isAria: true };
            }
        }

        logger.info(`falling back to dom mode: ${reason}`);
        const domTree = await this.domSimplifier.simplify();
        await this.domSimplifier.injectAttributes(this.ctx.page, this.domSimplifier.xpaths);
        const pseudoButtons = await this.domSimplifier.extractPseudoButtons(this.ctx.page);
        await this.#injectPseudoButtonRefs(pseudoButtons);
        const rawContext = this.domSimplifier.stringifySimplifiedDom(domTree);
        const context = this.domSimplifier.appendPseudoButtonsToSnapshot(rawContext, pseudoButtons);
        return { context, domTree, isAria: false };
    }

    /**
     * Injects data-ibr-ref attributes onto pseudo-button elements.
     * @param {Array} pseudoButtons - Result from extractPseudoButtons
     */
    async #injectPseudoButtonRefs(pseudoButtons) {
        if (!pseudoButtons || pseudoButtons.length === 0) return;
        this.pseudoButtonRefs = {};
        try {
            await this.ctx.page.evaluate((buttons) => {
                buttons.forEach((btn, i) => {
                    const ref = `c${i + 1}`;
                    try {
                        const el = document.querySelector(btn.selector);
                        if (el) el.setAttribute('data-ibr-ref', ref);
                    } catch {
                        // skip individual failures
                    }
                });
            }, pseudoButtons);

            pseudoButtons.forEach((btn, i) => {
                const ref = `c${i + 1}`;
                this.pseudoButtonRefs[ref] = btn.selector;
            });
        } catch (err) {
            logger.warn('Failed to inject pseudo-button refs', { error: err.message });
        }
    }

    /**
     * Returns a Playwright locator for a @c ref.
     * @param {string} ref - e.g. "c1"
     * @returns {import('playwright').Locator}
     */
    #resolvePseudoButtonRef(ref) {
        return this.ctx.page.locator(`[data-ibr-ref="${ref}"]`);
    }

    async #waitJitteredDelay(delay) {
        await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * INSTRUCTION_EXECUTION_JITTER_MS - INSTRUCTION_EXECUTION_JITTER_MS / 2));
    }

    async #preparePage() {
        let lastWindowScrollY;
        let scrollCount = 0;
        while (true) {
            const windowScrollY = await this.ctx.page.evaluate(() => window.scrollY);
            if (windowScrollY === lastWindowScrollY) {
                scrollCount++;
                if (scrollCount >= 2) {
                    break;
                }
            } else {
                scrollCount = 0;
                lastWindowScrollY = windowScrollY;
            }
            await this.ctx.page.evaluate(() => window.scrollTo(0, window.scrollY + window.screen.height*0.5));
            await this.#waitJitteredDelay(PAGE_LOADING_DELAY_MS);
        }
    }

    async #findElements(userPrompt) {
        const context = createErrorContext('find instruction', {
            instructionIndex: this.executionIndex
        });

        logger.info(`${context}: ${userPrompt}`);

        try {
            const { context: pageContext, domTree, isAria } = await this.#getPageContext();
            const domSignature = createDomSignature(pageContext);

            // Check cache first
            const cacheKey = this.cacheManager.generateKey(this.url, userPrompt, 'find');
            const cached = await this.cacheManager.get('find', cacheKey);

            if (cached && isDomCompatible(cached.metadata.lastDomSignature, domSignature)) {
                try {
                    // Try to apply cached schema (ARIA descriptors)
                    const descriptors = cached.schema.elementDescriptors || [];

                    if (descriptors.length > 0) {
                        await this.cacheManager.recordSuccess('find', cacheKey);
                        logger.info(`${context} completed (CACHE HIT)`, {
                            elementCount: descriptors.length
                        });
                        return descriptors;
                    }
                } catch (error) {
                    logger.debug('Cache application failed', { error: error.message });
                    await this.cacheManager.recordFailure('find', cacheKey);
                }
            }

            // Cache miss or invalid - call AI; prefer diff when available (dom mode only)
            let messages;
            let usedDiff = false;
            let diff = null;

            if (!isAria && this.snapshotDiffer.shouldUseDiff()) {
                diff = this.snapshotDiffer.computeDiff(domTree, this.domSimplifier.xpaths);
                if (!diff.largeChange) {
                    messages = makeFindInstructionWithDiffMessage(userPrompt, diff, pageContext);
                    usedDiff = true;
                    const diffSize = diff.added.length + diff.removed.length + diff.modified.length;
                    const estimatedSavedTokens = Math.max(0, pageContext.length - JSON.stringify(diff).length);
                    logger.debug('Using diff snapshot for AI find', {
                        diffSize,
                        estimatedSavedTokens,
                        summary: diff.summary,
                    });
                } else {
                    logger.debug('Diff too large (>50% nodes changed), falling back to full snapshot');
                    messages = makeFindInstructionMessageDom(userPrompt, pageContext);
                }
            } else if (!isAria) {
                messages = makeFindInstructionMessageDom(userPrompt, pageContext);
            } else {
                messages = makeFindInstructionMessage(userPrompt, pageContext);
            }

            // Store snapshot after deciding which path to use (dom mode only)
            if (!isAria && domTree) {
                this.snapshotDiffer.captureSnapshot(domTree, this.domSimplifier.xpaths);
            }

            logger.debug('Sending find instruction to AI', {
                promptLength: userPrompt.length,
                contextLength: pageContext.length,
                isAria,
                usedDiff,
            });

            const response = await generateAIResponse(
                this.ctx.aiProvider.modelInstance,
                messages,
                { temperature: this.temperature }
            );

            this.#updateTokenUsage(response.usage);

            const output = response.content?.trim();
            let elements;

            try {
                elements = output ? parseFindElementsResponse(output) : [];
            } catch (parseErr) {
                logger.warn(createParseErrorMessage('element finding', output, parseErr));
                elements = [];
            }

            // Cache successful result
            if (elements.length > 0) {
                const schema = extractSchema('find', elements);
                await this.cacheManager.set('find', cacheKey, {
                    schema,
                    metadata: { lastDomSignature: domSignature }
                });
            }

            const elementCount = Array.isArray(elements) ? elements.length : 0;
            logger.info(`${context} completed`, {
                elementCount,
                usedDiff,
                ...(usedDiff && diff ? { diffSummary: diff.summary } : {}),
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens
            });

            // --annotate mode: capture screenshot of found elements
            if (this.annotateMode && elementCount > 0) {
                const shotPath = `/tmp/ibr-annotate-step-${this.executionIndex}-${Date.now()}.png`;
                await this.annotationService.captureAnnotatedScreenshot(
                    elements,
                    shotPath,
                    this.domSimplifier.xpaths
                );
                // WSM: persist annotated screenshot as visual evidence artifact
                await wsmAdapter.recordArtifact(shotPath, 'screenshot').catch(() => {});
            }

            return elements;
        } catch (error) {
            const alreadyAnnotated = error.message.includes('--- observability ---');
            const obs = alreadyAnnotated ? '' : this.observabilityBuffer.flush();
            const errMsg = alreadyAnnotated
                ? error.message
                : `${error.message}\n--- observability ---\n${obs}`;
            logger.error(`${context} failed`, {
                error: errMsg,
                executionIndex: this.executionIndex
            });
            throw alreadyAnnotated
                ? error
                : ensureCliError(error, 'RUNTIME_ERROR', { message: errMsg });
        }
    }

    async #waitForHumanInstruction(instruction) {
        const context = createErrorContext('wait for human instruction', {
            instructionIndex: this.executionIndex
        });

        const reason = instruction.prompt || 'Manual intervention needed';

        // Guard: waiting for ENTER on a stdin that is not a TTY (headless CLI,
        // n8n, `< /dev/null`) blocks forever — the line never arrives. Fail
        // fast with an actionable error instead of hanging silently, unless
        // the caller explicitly opted in to waiting on piped stdin.
        const allowPiped = process.env.IBR_WAIT_FOR_HUMAN_ALLOW_PIPED?.toLowerCase() === 'true';
        if (!process.stdin.isTTY && !allowPiped) {
            const message =
                `${context}: cannot wait for human input ("${reason}") — stdin is not a TTY, ` +
                `so ENTER would never arrive and the task would hang. If this step was meant ` +
                `to wait for the page or an element to load, rephrase it as a timed wait ` +
                `(e.g. "wait 5 seconds") — page/element waits must not be wait_for_human. ` +
                `To wait for a line on piped stdin anyway, set IBR_WAIT_FOR_HUMAN_ALLOW_PIPED=true.`;
            logger.error(message);
            throw new CliError('WAIT_FOR_HUMAN_NO_TTY', message, { step: 'wait_for_human' });
        }

        logger.warn(`${context}: PAUSED - ${reason}`);
        console.warn(`\n[ibr] PAUSED: ${reason}`);
        console.warn(`[ibr] Waiting for you — please perform the necessary actions in the browser window.`);
        console.warn(`[ibr] Press ENTER in this terminal when ready to resume...`);

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve, reject) => {
            let resumed = false;
            rl.on('line', () => {
                resumed = true;
                rl.close();
                logger.info(`${context} resumed`);
                resolve();
            });
            // Piped stdin can end (EOF) before any line arrives; without this
            // the promise would never settle and the task would hang forever.
            rl.on('close', () => {
                if (resumed) return;
                const message =
                    `${context}: stdin ended before ENTER was received while waiting for ` +
                    `human input ("${reason}"). Provide a line on stdin to resume, or ` +
                    `rephrase page/element waits as timed "wait" instructions.`;
                logger.error(message);
                reject(new CliError('WAIT_FOR_HUMAN_STDIN_CLOSED', message, { step: 'wait_for_human' }));
            });
        });
    }

    async #waitInstruction(instruction) {
        const context = createErrorContext('wait instruction', {
            instructionIndex: this.executionIndex
        });

        const seconds = parseInt(instruction.prompt, 10) || 5;
        logger.info(`${context}: Waiting for ${seconds} seconds`);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        logger.info(`${context} completed`);
    }
}
