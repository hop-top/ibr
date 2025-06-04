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
        await this.#waitJitteredDelay(PAGE_LOADING_DELAY_MS);
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
        await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
        const elements = await this.#findElements(instruction.prompt);
        if (elements.length > 0) {
            await this.#executeInstructions(instruction.success_instructions);
        } else {
            await this.#executeInstructions(instruction.failure_instructions);
        }
    }

    async #loopInstruction(instruction) {
        while (true) {
            await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
            const elements = await this.#findElements(instruction.prompt);
            if (elements.length > 0) {
                await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
                await this.#executeInstructions(instruction.instructions);
            } else {
                // break if condition elements not found
                break;
            }
        }
    }

    async #extractInstruction(instruction) {
        await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
        const domTree = await this.domSimplifier.simplify();
        const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);
        const messages = makeExtractInstructionMessage(instruction.prompt, domTreeString);
        logger.info(`Extract instruction ${instruction.prompt}`);
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
        await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
        const domTree = await this.domSimplifier.simplify();
        const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);
        const messages = makeActionInstructionMessage(instruction.prompt, domTreeString);
        logger.info(`Action instruction ${instruction.prompt}`);
        // logger.debug('Action instruction message', { message: messages[1].content });

        const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
        });

        const output = response.choices[0]?.message?.content?.trim();
        const action = output ? JSON.parse(output) : {elements: []};
        
        logger.info(`Action instruction result ${JSON.stringify(action)}`);

        if (action.elements.length > 0) {
            const elementXPath = this.domSimplifier.xpaths[action.elements[0].x];
            // scroll element into view
            await this.ctx.page.locator(`xpath=${elementXPath}`).scrollIntoViewIfNeeded();
            await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
            switch (action.type) {
                case 'click':
                    logger.info(`Clicking element at ${elementXPath}`);
                    await this.ctx.page.locator(`xpath=${elementXPath}`).click();
                    break;
                case 'fill':
                    logger.info(`Filling element at ${elementXPath} with value ${action.value}`);
                    await this.ctx.page.locator(`xpath=${elementXPath}`).fill(action.value);
                    break;
                case 'type':
                    logger.info(`Typing ${action.value} into element at ${elementXPath}`);
                    await this.ctx.page.locator(`xpath=${elementXPath}`).type(action.value);
                    break;
                case 'press':
                    logger.info(`Pressing ${action.value} on element at ${elementXPath}`);
                    await this.ctx.page.locator(`xpath=${elementXPath}`).press(action.value);
                    break;
                // case 'scroll':
                //     const element = await this.ctx.page.locator(`xpath=${elementXPath}`);
                //     await element.evaluate(() => window.scrollTo(0, window.screen.height*0.5));
                //     break;
            }
            await this.#waitJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS);
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
        const domTree = await this.domSimplifier.simplify();
        const domTreeString = this.domSimplifier.stringifySimplifiedDom(domTree);
        const messages = makeFindInstructionMessage(userPrompt, domTreeString);
        logger.info(`Find instruction: ${userPrompt}`);;

        const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
        });

        const output = response.choices[0]?.message?.content?.trim();
        logger.info(`Find instruction result ${JSON.stringify(output)}`);
        return output ? JSON.parse(output) : [];
    }
}