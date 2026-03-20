import { makeTaskDescriptionMessage, makeFindInstructionMessage, makeActionInstructionMessage, makeExtractInstructionMessage } from "./utils/prompts.js";
import { DomSimplifier } from './DomSimplifier.js';
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
     */
    constructor(ctx, options = {}) {
        this.ctx = ctx;
        this.domSimplifier = new DomSimplifier(ctx.page);
        this.extracts = [];
        this.cacheManager = new CacheManager();
        this.observabilityBuffer = new ObservabilityBuffer();

        // Attach observability listeners
        const page = ctx.page;
        this._onConsole = (msg) => this.observabilityBuffer.addConsoleLog(msg.type(), msg.text());
        this._onRequest = (req) => this.observabilityBuffer.addNetworkRequest(req.method(), req.url());
        this._onResponse = (res) => {
            const req = res.request();
            const duration = req ? (Date.now() - (req._startTime || Date.now())) : null;
            this.observabilityBuffer.matchNetworkResponse(res.url(), res.status(), duration);
        };
        page.on('console', this._onConsole);
        page.on('request', this._onRequest);
        page.on('response', this._onResponse);

        // Improved token tracking
        this.tokenUsage = {
            prompt: 0,
            completion: 0,
            total: 0
        };

        // Configuration
        this.temperature = Math.min(2, Math.max(0, options.temperature ?? 0));
        this.executionIndex = 0;

        logger.debug('Operations initialized', {
            provider: ctx.aiProvider.provider,
            model: ctx.aiProvider.model,
            temperature: this.temperature
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

        // Reset observability buffer for this task run
        this.observabilityBuffer.clear();

        try {
            logger.debug('Navigating to URL', { url: taskDescription.url });
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
            page.removeAllListeners('console');
            page.removeAllListeners('request');
            page.removeAllListeners('response');
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
            logger.error(`${context} failed`, {
                error: error.message,
                executionIndex: this.executionIndex
            });
            throw error;
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
            logger.error(`${context} failed`, {
                error: error.message,
                executionIndex: this.executionIndex
            });
            throw error;
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
            const domTree = await this.domSimplifier.simplify();
            const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);

            // Note: For extraction, we always call AI for fresh data
            // Caching would require re-extracting from current DOM
            const messages = makeExtractInstructionMessage(instruction.prompt, domTreeString);

            logger.debug('Sending extract instruction to AI', {
                promptLength: instruction.prompt.length,
                domLength: domTreeString.length
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
            const obs = this.observabilityBuffer.flush();
            const errMsg = `${error.message}\n--- observability ---\n${obs}`;
            logger.error(`${context} failed`, {
                error: errMsg,
                executionIndex: this.executionIndex
            });
            throw new Error(errMsg);
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
            const domTree = await this.domSimplifier.simplify();
            const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);
            const domSignature = createDomSignature(domTree);

            // Check cache first
            const cacheKey = this.cacheManager.generateKey(this.url, instruction.prompt, 'action');
            const cached = await this.cacheManager.get('action', cacheKey);

            let action;

            if (cached && isDomCompatible(cached.metadata.lastDomSignature, domSignature)) {
                try {
                    // Try to apply cached schema
                    const { elementIndices, actionType, actionValue } = cached.schema;
                    if (elementIndices && elementIndices.length > 0) {
                        action = {
                            elements: elementIndices.map(idx => ({ x: idx })),
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
                const messages = makeActionInstructionMessage(instruction.prompt, domTreeString);

                logger.debug('Sending action instruction to AI', {
                    promptLength: instruction.prompt.length,
                    domLength: domTreeString.length
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
                const elementIndex = action.elements[0].x;
                const elementXPath = this.domSimplifier.xpaths[elementIndex];

                if (!elementXPath) {
                    throw new Error(`Invalid element index ${elementIndex} - XPath not found. DOM may have changed.`);
                }

                try {
                    logger.debug(`Scrolling element into view`, { xpath: elementXPath });
                    await this.ctx.page.locator(`xpath=${elementXPath}`).scrollIntoViewIfNeeded();
                    await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);

                    const actionType = action.type?.toLowerCase();
                    switch (actionType) {
                        case 'click':
                            logger.info(`${context}: Clicking element`, { xpath: elementXPath });
                            await this.ctx.page.locator(`xpath=${elementXPath}`).click();
                            break;
                        case 'fill':
                            logger.info(`${context}: Filling element with text`, { xpath: elementXPath, valueLength: action.value?.length || 0 });
                            await this.ctx.page.locator(`xpath=${elementXPath}`).fill(action.value);
                            break;
                        case 'type':
                            logger.info(`${context}: Typing into element`, { xpath: elementXPath, valueLength: action.value?.length || 0 });
                            await this.ctx.page.locator(`xpath=${elementXPath}`).type(action.value);
                            break;
                        case 'press':
                            logger.info(`${context}: Pressing key`, { xpath: elementXPath, key: action.value });
                            await this.ctx.page.locator(`xpath=${elementXPath}`).press(action.value);
                            break;
                        default:
                            logger.warn(`${context}: Unknown action type`, { actionType });
                    }
                    await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
                    logger.info(`${context} executed successfully`, { actionType });
                } catch (actionError) {
                    logger.error(`${context} execution failed`, {
                        xpath: elementXPath,
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
            const obs = this.observabilityBuffer.flush();
            const errMsg = `${error.message}\n--- observability ---\n${obs}`;
            logger.error(`${context} failed`, {
                error: errMsg,
                executionIndex: this.executionIndex
            });
            throw new Error(errMsg);
        }
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
            const domTree = await this.domSimplifier.simplify();
            const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);
            const domSignature = createDomSignature(domTree);

            // Check cache first
            const cacheKey = this.cacheManager.generateKey(this.url, userPrompt, 'find');
            const cached = await this.cacheManager.get('find', cacheKey);

            if (cached && isDomCompatible(cached.metadata.lastDomSignature, domSignature)) {
                try {
                    // Try to apply cached schema
                    const indices = cached.schema.elementIndices || [];
                    const elements = indices.map(idx => ({ x: idx }));

                    if (elements.length > 0) {
                        await this.cacheManager.recordSuccess('find', cacheKey);
                        logger.info(`${context} completed (CACHE HIT)`, {
                            elementCount: elements.length
                        });
                        return elements;
                    }
                } catch (error) {
                    logger.debug('Cache application failed', { error: error.message });
                    await this.cacheManager.recordFailure('find', cacheKey);
                }
            }

            // Cache miss or invalid - call AI
            const messages = makeFindInstructionMessage(userPrompt, domTreeString);

            logger.debug('Sending find instruction to AI', {
                promptLength: userPrompt.length,
                domLength: domTreeString.length
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
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens
            });

            return elements;
        } catch (error) {
            const obs = this.observabilityBuffer.flush();
            const errMsg = `${error.message}\n--- observability ---\n${obs}`;
            logger.error(`${context} failed`, {
                error: errMsg,
                executionIndex: this.executionIndex
            });
            throw new Error(errMsg);
        }
    }
}