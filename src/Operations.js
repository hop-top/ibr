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
import { SnapshotDiffer } from './utils/SnapshotDiffer.js';
import { getSnapshot, resolveElement, selectMode } from './utils/ariaSimplifier.js';
import { INSTRUCTION_EXECUTION_DELAY_MS, INSTRUCTION_EXECUTION_JITTER_MS, PAGE_LOADING_DELAY_MS } from "./utils/constants.js";
import { generateAIResponse } from './ai/provider.js';
import { validateTaskDescription, validateAndParseJSON, createParseErrorMessage, createErrorContext } from './utils/validation.js';
import { parseTaskDescriptionResponse, parseFindElementsResponse, parseActionInstructionResponse, parseExtractionResponse } from './ai/baml-parser.js';
import { CacheManager } from './cache/CacheManager.js';
import { createDomSignature, isDomCompatible, getValidator, extractSchema } from './cache/CacheUtils.js';
import logger from './utils/logger.js';
import { ObservabilityBuffer } from './observability/ObservabilityBuffer.js';

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
        this.snapshotDiffer = new SnapshotDiffer();
        this.observabilityBuffer = new ObservabilityBuffer();
        this._requestStartTimes = new WeakMap();

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
            mode: this.mode
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
            default:
                throw new Error(`Unknown instruction type: ${instruction.name}`);
        }
    }

    async #executeInstructions(instructions) {
        for (const instruction of instructions) {
            await this.#executeInstruction(instruction);
        }
    }

    async executeTask(taskDescription) {
        logger.info('Executing task', {
            url: taskDescription.url,
            instructionCount: taskDescription.instructions.length
        });

        // Initialize cache
        await this.cacheManager.init();
        this.url = taskDescription.url;

        // Reset observability buffer; set page origin for cross-origin detection
        try {
            this.observabilityBuffer.pageOriginHost = new URL(taskDescription.url).host;
        } catch {
            this.observabilityBuffer.pageOriginHost = null;
        }
        this.observabilityBuffer.clear();

        // Re-attach listeners each task (they were removed in the previous finally)
        const page = this.ctx.page;
        if (page?.on) {
            page.on('console', this._onConsole);
            page.on('request', this._onRequest);
            page.on('response', this._onResponse);
        }

        try {
            logger.debug('Navigating to URL', { url: taskDescription.url });
            this.snapshotDiffer.reset();
            await this.ctx.page.goto(taskDescription.url, { waitUntil: 'networkidle' });
            await this.#waitJitteredDelay(PAGE_LOADING_DELAY_MS);

            logger.debug('Preparing page');
            await this.#preparePage();

            logger.info('Starting instruction execution', {
                count: taskDescription.instructions.length
            });
            await this.#executeInstructions(taskDescription.instructions);

            logger.info('Task execution completed successfully');
        } catch (error) {
            logger.error('Task execution failed', {
                url: taskDescription.url,
                executionIndex: this.executionIndex,
                error: error.message
            });
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
            throw new Error('Task description cannot be empty');
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
                throw new Error('AI model returned empty response');
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
            throw alreadyAnnotated ? error : new Error(errMsg, { cause: error });
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
            throw alreadyAnnotated ? error : new Error(errMsg, { cause: error });
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

            logger.info(`${context} completed`, {
                extractedFields: Object.keys(extract).length,
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens
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
            throw alreadyAnnotated ? error : new Error(errMsg, { cause: error });
        }
    }

    async #actionInstruction(instruction) {
        const context = createErrorContext('action instruction', {
            instructionIndex: this.executionIndex,
            instructionName: instruction.name
        });

        logger.info(`${context}: ${instruction.prompt}`);

        try {
            await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
            const { context: pageContext, isAria } = await this.#getPageContext();
            const domSignature = createDomSignature(pageContext);

            // Check cache first
            const cacheKey = this.cacheManager.generateKey(this.url, instruction.prompt, 'action');
            const cached = await this.cacheManager.get('action', cacheKey);

            let action;

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
                const locator = isAria
                    ? resolveElement(this.ctx.page, descriptor)
                    : (() => {
                        // DOM fallback: descriptor may still have {x} index
                        if (typeof descriptor.x === 'number') {
                            const xpath = this.domSimplifier.xpaths[descriptor.x];
                            if (!xpath) throw new Error(`Invalid element index ${descriptor.x} - XPath not found.`);
                            return this.ctx.page.locator(`xpath=${xpath}`);
                        }
                        // Also accept {role,name} even in fallback mode
                        return resolveElement(this.ctx.page, descriptor);
                    })();

                if (!locator) {
                    throw new Error(`Unable to resolve element descriptor: ${JSON.stringify(descriptor)}`);
                }

                try {
                    logger.debug(`Scrolling element into view`, { descriptor });
                    await locator.scrollIntoViewIfNeeded();
                    await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);

                    const actionType = action.type?.toLowerCase();
                    switch (actionType) {
                        case 'click':
                            logger.info(`${context}: Clicking element`, { descriptor });
                            await locator.click();
                            break;
                        case 'fill':
                            logger.info(`${context}: Filling element`, { descriptor, valueLength: action.value?.length || 0 });
                            await locator.fill(action.value);
                            break;
                        case 'type':
                            logger.info(`${context}: Typing into element`, { descriptor, valueLength: action.value?.length || 0 });
                            await locator.type(action.value);
                            break;
                        case 'press':
                            logger.info(`${context}: Pressing key`, { descriptor, key: action.value });
                            await locator.press(action.value);
                            break;
                        default:
                            logger.warn(`${context}: Unknown action type`, { actionType });
                    }
                    await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
                    // Reset snapshot after action so next #findElements gets fresh diff baseline
                    this.snapshotDiffer.reset();
                    logger.info(`${context} executed successfully`, { actionType });
                } catch (actionError) {
                    logger.error(`${context} execution failed`, {
                        descriptor,
                        actionType: action.type,
                        error: actionError.message
                    });
                    throw new Error(`Failed to execute action: ${actionError.message}`);
                }
            } else {
                logger.info(`${context}: No matching elements found, skipping action`);
            }

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
            throw alreadyAnnotated ? error : new Error(errMsg, { cause: error });
        }
    }

    /**
     * Get page context string for AI.
     * Uses quality-based mode selection (aria/dom) with optional forced mode.
     * Returns {context: string, domTree: Object|null, isAria: boolean}
     */
    async #getPageContext() {
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
        const context = this.domSimplifier.stringifySimplifiedDom(domTree);
        return { context, domTree, isAria: false };
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
            const { context: pageContext, isAria } = await this.#getPageContext();
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
            throw alreadyAnnotated ? error : new Error(errMsg, { cause: error });
        }
    }
}