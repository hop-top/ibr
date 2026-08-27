import {
    makeTaskDescriptionMessage,
    makeFindInstructionMessage,
    makeFindInstructionWithDiffMessage,
    makeActionInstructionMessage,
    makeExtractInstructionMessage,
    makeFindInstructionMessageDom,
    makeActionInstructionMessageDom,
    makeExtractInstructionMessageDom,
} from "./utils/prompts.js";
import { DomSimplifier } from './DomSimplifier.js';
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
import { AnnotationService } from './services/AnnotationService.js';
import { streamer } from './observability/NdjsonStreamer.js';
import { wsmAdapter } from './services/WsmAdapter.js';
import { augmentationEngine } from './services/AugmentationEngine.js';
import { HealingService } from './services/HealingService.js';
import { infraManager } from './browser/resolvers/InfraManager.js';
import { CliError, ensureCliError } from './utils/cliErrors.js';

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
        this.executionIndex = 0;

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

    async executeTask(taskDescription) {
        this.executionIndex = 0;
        logger.info('Executing task', {
            url: taskDescription.url,
            instructionCount: taskDescription.instructions.length
        });

        const taskStartMs = Date.now();
        streamer.taskStart({ prompt: taskDescription.url });

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
            await this.#executeInstructions(taskDescription.instructions);

            logger.info('Task execution completed successfully');
            streamer.taskEnd({ startMs: taskStartMs, status: 'success' });
        } catch (error) {
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
            const { context: pageContext, isAria } = await this.#getPageContext();

            // Note: For extraction, we always call AI for fresh data
            // Caching would require re-extracting from current DOM
            const makeExtract = isAria ? makeExtractInstructionMessage : makeExtractInstructionMessageDom;
            const messages = makeExtract(instruction.prompt, pageContext);

            logger.debug('Sending extract instruction to AI', {
                promptLength: instruction.prompt.length,
                contextLength: pageContext.length
            });

            const response = await generateAIResponse(
                this.ctx.aiProvider.modelInstance,
                messages,
                { temperature: this.temperature }
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
                logger.warn(createParseErrorMessage('extraction', output, parseErr));
                extract = [];
            }

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

            const { context: pageContext, isAria } = await this.#getPageContext();
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

            if (action && action.elements && action.elements.length > 0) {
                const descriptor = action.elements[0];
                const elementRef = descriptor.x;
                const refStr = elementRef != null ? String(elementRef).replace(/^@/, '') : '';

                let locator;
                let locatorDesc;
                if (!isAria && refStr.startsWith('c') && this.pseudoButtonRefs[refStr]) {
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
                                logger.warn(`${context}: Unknown action type`, { actionType });
                        }
                    };

                    try {
                        await performAction();
                    } catch (actionError) {
                        // Attempt to heal if not already raw/ignored
                        if (!this.ignoreAugmentations) {
                            const fix = await this.healingService.attemptHeal(this.ctx.page, instruction, locator, actionError);
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
                        const shotPath = `/tmp/ibr-annotate-step-${this.executionIndex}-${Date.now()}.png`;
                        await this.annotationService.captureAnnotatedScreenshot(
                            action.elements || [],
                            shotPath,
                            isAria ? null : this.domSimplifier.xpaths
                        ).catch(() => {}); // non-fatal
                        // WSM: record artifact
                        await wsmAdapter.recordArtifact(shotPath, 'screenshot').catch(() => {});
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
                logger.info(`${context}: No matching elements found, skipping action`);
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
