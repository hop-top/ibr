import { makeTaskDescriptionMessage, makeFindInstructionMessage, makeActionInstructionMessage, makeExtractInstructionMessage } from "./utils/prompts.js";
import { DomSimplifier } from './DomSimplifier.js';
import { INSTRUCTION_EXECUTION_DELAY_MS, INSTRUCTION_EXECUTION_JITTER_MS, PAGE_LOADING_DELAY_MS } from "./utils/constants.js";

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
            // wait a randomly jittered delay
            // jitter can be positive or negative
            await new Promise((resolve) => setTimeout(resolve, this.#getJitteredDelay(INSTRUCTION_EXECUTION_DELAY_MS)));
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
            console.error("Failed to parse JSON:", err);
            console.error("Model output:", output);
            return null;
        }
    }

    async #conditionInstruction(instruction) {
        console.info("Condition instruction: ", instruction.name);
        const elements = await this.#findElements(instruction.prompt);
        if (elements.length > 0) {
            await this.#executeInstructions(instruction.success_instructions);
        } else {
            await this.#executeInstructions(instruction.failure_instructions);
        }
    }

    async #loopInstruction(instruction) {
        console.info("Loop instruction: ", instruction.name);

        while (true) {
            console.info("checking condition")
            const elements = await this.#findElements(instruction.prompt);
            if (elements.length > 0) {
                console.info("condition met")
                await this.#executeInstructions(instruction.instructions);
            } else {
                console.info("condition not met")
                // break if condition elements not found
                break;
            }
        }
    }

    async #extractInstruction(instruction) {
        console.log("Extract instruction: ", instruction.name);

        const domTree = await this.domSimplifier.simplify();
        const messages = makeExtractInstructionMessage(instruction.prompt, this.domSimplifier.stringifySimplifiedDom(domTree));

        const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
        });

        const output = response.choices[0]?.message?.content?.trim();
        console.info(`Extract response: ${output}`);

        try {
            const extract = output ? JSON.parse(output) : {};
            this.extracts.push(extract);
        } catch (err) {
            console.error("Failed to parse extract response:", err);
            console.error("Model output:", output); 
        }
    }

    async #actionInstruction(instruction) {
        console.log("Action instruction: ", instruction.name);

        const domTree = await this.domSimplifier.simplify();
        const messages = makeActionInstructionMessage(instruction.prompt, this.domSimplifier.stringifySimplifiedDom(domTree));

        const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
        });

        const output = response.choices[0]?.message?.content?.trim();
        console.info(`Action elements response: ${output}`);

        let action;
        try {
            action = output ? JSON.parse(output) : {};
        } catch (err) {
            console.error("Failed to parse action elements response:", err);
            action = {};
        }

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
        } else {
            console.error("No elements found for action");
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
        const messages = makeFindInstructionMessage(userPrompt, this.domSimplifier.stringifySimplifiedDom(domTree));

        const response = await this.ctx.aiClient.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: messages,
            temperature: 0,
        });

        const output = response.choices[0]?.message?.content?.trim();
        console.info(`Find elements response: ${output}`);

        try {
            return output ? JSON.parse(output) : [];
        } catch (err) {
            console.error("Failed to parse find elements response:", err);
            return [];
        }
    }
}