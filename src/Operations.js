import { makeTaskDescriptionMessage, makeFindInstructionMessage, makeActionInstructionMessage, makeExtractInstructionMessage } from "./utils/prompts.js";
import { DomSimplifier } from './DomSimplifier.js';
import { INSTRUCTION_EXECUTION_DELAY_MS, INSTRUCTION_EXECUTION_JITTER_MS, PAGE_LOADING_DELAY_MS } from "./utils/constants.js";
import logger from './utils/logger.js';

export class Operations {
    /**
     * @param {Object} ctx - The context object
     * @param {OpenAI} ctx.aiClient - The AI client instance
     * @param {Page} ctx.page - The Playwright page instance
     */
    constructor(ctx) {
        this.ctx = ctx;
        this.domSimplifier = new DomSimplifier(ctx.page);
        this.extracts = [];
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
        await this.ctx.page.goto(taskDescription.url);
        await new Promise((resolve) => setTimeout(resolve, PAGE_LOADING_DELAY_MS));
        await this.#preparePage();
        await this.#executeInstructions(taskDescription.instructions);
    }

    async parseTaskDescription(text) {
        const messages = makeTaskDescriptionMessage(text);
            const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
            });

        const output = response.choices[0]?.message?.content?.trim();

        try {
            if (output) {
                return JSON.parse(output);
            }
            throw new Error("No output from model");
        } catch (err) {
            logger.error("Failed to parse JSON:", err);
            logger.error("Model output:", output);
            return null;
        }
    }

    async #conditionInstruction(instruction) {
        await new Promise((resolve) => setTimeout(resolve, this.#getJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS)));
        const elements = await this.#findElements(instruction.prompt);
        if (elements.length > 0) {
            await this.#executeInstructions(instruction.success_instructions);
        } else {
            await this.#executeInstructions(instruction.failure_instructions);
        }
    }

    async #loopInstruction(instruction) {
        while (true) {
            await new Promise((resolve) => setTimeout(resolve, this.#getJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS)));
            const elements = await this.#findElements(instruction.prompt);
            if (elements.length > 0) {
                await new Promise((resolve) => setTimeout(resolve, this.#getJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS)));
                await this.#executeInstructions(instruction.instructions);
            } else {
                // break if condition elements not found
                break;
            }
        }
    }

    async #extractInstruction(instruction) {
        await new Promise((resolve) => setTimeout(resolve, this.#getJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS)));
        const domTree = await this.domSimplifier.simplify();
        const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);
        const messages = makeExtractInstructionMessage(instruction.prompt, domTreeString);
        logger.info('Extract instruction', { instruction: instruction.prompt });
        // logger.debug('Extract instruction message', { message: messages[1].content });

        const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
        });

        const output = response.choices[0]?.message?.content?.trim();
        const extract = output ? JSON.parse(output) : {};
        this.extracts.push(extract);
    }

    async #actionInstruction(instruction) {
        await new Promise((resolve) => setTimeout(resolve, this.#getJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS)));
        const domTree = await this.domSimplifier.simplify();
        const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);
        const messages = makeActionInstructionMessage(instruction.prompt, domTreeString);
        logger.info('Action instruction', { instruction: instruction.prompt });
        // logger.debug('Action instruction message', { message: messages[1].content });

        const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
        });

        const output = response.choices[0]?.message?.content?.trim();
        const action = output ? JSON.parse(output) : {elements: []};

        if (action.elements.length > 0) {
            const elementXPath = this.domSimplifier.xpaths[action.elements[0].x];
            switch (action.type) {
                case 'click':
                    await this.ctx.page.locator(`xpath=${elementXPath}`).click();
                    break;
                case 'fill':
                    await this.ctx.page.locator(`xpath=${elementXPath}`).fill(action.value);
                    break;
                case 'type':
                    await this.ctx.page.locator(`xpath=${elementXPath}`).type(action.value);
                    break;
                case 'press':
                    await this.ctx.page.locator(`xpath=${elementXPath}`).press(action.value);
                    break;
                // case 'scroll':
                //     const element = await this.ctx.page.locator(`xpath=${elementXPath}`);
                //     await element.evaluate(() => window.scrollTo(0, window.screen.height*0.5));
                //     break;
            }
        }
    }

    #getJitteredDelay(delay) {
        return delay + Math.random() * INSTRUCTION_EXECUTION_JITTER_MS - INSTRUCTION_EXECUTION_JITTER_MS / 2;
    }

    async #preparePage() {
        let lastHeight = 0;
        let scrollCount = 0;
        while (true) {
            const height = await this.ctx.page.evaluate(() => document.body.scrollHeight);
            if (height === lastHeight) {
                scrollCount++;
                if (scrollCount >= 2) {
                    break;
                }
            } else {
                scrollCount = 0;
                lastHeight = height;
            }
            await this.ctx.page.evaluate(() => window.scrollTo(0, window.screen.height*0.5));
            await new Promise((resolve) => setTimeout(resolve, this.#getJitteredDelay(PAGE_LOADING_DELAY_MS)));
        }
    }

    async #findElements(userPrompt) {
        const domTree = await this.domSimplifier.simplify();
        const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);
        const messages = makeFindInstructionMessage(userPrompt, domTreeString);
        logger.info('Find instruction', { instruction: userPrompt });
        // logger.debug('Find instruction message', { message: messages[1].content });

        const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
        });

        const output = response.choices[0]?.message?.content?.trim();
        return output ? JSON.parse(output) : [];
    }
}