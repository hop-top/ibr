import { Session } from '@hop-top/fit';
import { xrrService } from './XrrService.js';
import { generateAIResponse } from '../ai/provider.js';
import { augmentationEngine } from './AugmentationEngine.js';
import { infraManager } from '../browser/resolvers/InfraManager.js';
import { createDomSignature } from '../cache/CacheUtils.js';
import logger from '../utils/logger.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

const LEARNINGS_PATH = path.join(os.homedir(), '.ibr', 'learnings.json');

/**
 * LearningsStore — indexes successful heals by structural signature and error type.
 */
class LearningsStore {
  constructor(filePath = process.env.IBR_LEARNINGS_FILE || LEARNINGS_PATH) {
    this.filePath = filePath;
    this.learnings = {};
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      this.learnings = JSON.parse(data);
    } catch (err) {
      this.learnings = {};
    }
    this.initialized = true;
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.learnings, null, 2), 'utf8');
    } catch (err) {
      logger.error('LearningsStore: failed to save', { error: err.message });
    }
  }

  /**
   * Get successful rules for a similar structural signature.
   */
  getSimilarLearnings(signature, errorType) {
    const key = `${signature}:${errorType}`;
    return this.learnings[key] || [];
  }

  async recordSuccess(signature, errorType, rule) {
    const key = `${signature}:${errorType}`;
    if (!this.learnings[key]) this.learnings[key] = [];
    
    // Avoid duplicates
    if (!this.learnings[key].find(r => r.id === rule.id)) {
      this.learnings[key].push(rule);
      await this.save();
    }
  }
}

/**
 * HealingScorer — verifies if a proposed fix makes the target element clickable.
 */
class HealingScorer {
  constructor(page, targetLocator) {
    this.page = page;
    this.targetLocator = targetLocator;
  }

  async score(output, context) {
    try {
      const rule = JSON.parse(output);
      
      if (rule.action === 'switch_provider') {
          logger.info('HealingScorer: accepting infra-switch hypothesis', { provider: rule.provider });
          return { score: 1.0, breakdown: { switch: 1.0 }, metadata: { rule } };
      }

      logger.debug('HealingScorer: testing rule', { ruleId: rule.id, mutations: rule.domMutations });
      
      await this.page.evaluate((r) => {
        r.domMutations?.remove?.forEach(sel => {
            const el = document.querySelector(sel);
            if (el) el.remove();
        });
      }, rule);

      const isVisible = await this.targetLocator.isVisible();
      const isEnabled = await this.targetLocator.isEnabled();
      
      logger.debug('HealingScorer: check target state', { isVisible, isEnabled });

      if (isVisible && isEnabled) {
        return { score: 1.0, breakdown: { visible: 1.0, enabled: 1.0 }, metadata: { rule } };
      }
      
      return { score: 0.0, breakdown: { visible: isVisible ? 1.0 : 0.0, enabled: isEnabled ? 1.0 : 0.0 } };
    } catch (err) {
      logger.warn('HealingScorer: failed to score', { error: err.message });
      return { score: null, metadata: { error: err.message } };
    }
  }
}

/**
 * HealingService — autonomous self-healing for page obstructions.
 */
export class HealingService {
  constructor(ops) {
    this.ops = ops;
    this.learningsStore = new LearningsStore();
  }

  async init() {
    await this.learningsStore.init();
  }

  /**
   * Attempt to heal a failed operation.
   *
   * `visualContext` (SPEC Unit 4) is an OPTIONAL trailing arg — {image, mime,
   * markMap} from Operations.js's cached _visualRepresentation, when a visual
   * escalation resolved a mark but the subsequent action then failed. When
   * omitted (every caller before this feature, and the pure-text-failure
   * path), behavior is byte-identical to before this feature: no image is
   * added to the heal prompt or the generateAIResponse options, and the
   * emitted fix shape (the persisted augmentations rule) is unchanged either
   * way — the image only informs the HYPOTHESIS, never the output shape.
   *
   * @param {import('playwright').Page} page
   * @param {Object} instruction
   * @param {import('playwright').Locator} targetLocator
   * @param {Error} error
   * @param {{image?: Buffer, mime?: string, markMap?: Map}} [visualContext]
   */
  async attemptHeal(page, instruction, targetLocator, error, visualContext = null) {
    logger.info('HealingService: initiating Heal Mode', { instruction: instruction.prompt });
    
    const url = page.url();
    const html = await page.content(); // Fallback context
    const signature = createDomSignature(html);
    const errorType = error.name || 'UNKNOWN_ERROR';

    // 1. Get similar learnings to guide inference
    const similarRules = this.learningsStore.getSimilarLearnings(signature, errorType);
    const iclContext = similarRules.length > 0 
      ? `\n\nPreviously successful fixes for similar structures:\n${similarRules.map(r => `- ${JSON.stringify(r.domMutations)}`).join('\n')}`
      : '';

    // Visual-informed hypothesis (SPEC Unit 4, additive-only): when the
    // caller passed a screenshot from a visual escalation attempt, name its
    // marks in the prompt so the healer can point at the visual obstruction
    // (e.g. "mark @e7 is a full-screen modal"). With no image, this block
    // contributes nothing and the prompt is byte-identical to before.
    const hasVisualImage = Boolean(visualContext?.image);
    const visualMarkLabels = visualContext?.markMap ? [...visualContext.markMap.keys()] : [];
    const visualContextText = hasVisualImage
      ? `\n\nA screenshot of the current page is attached, with visual marks overlaid at candidate elements${visualMarkLabels.length > 0 ? ` (labels: ${visualMarkLabels.join(', ')})` : ''}. Use it to identify what is visually blocking or obscuring the target — name the mark if relevant.`
      : '';

    // 2. Define fit Advisor (LLM as Healer)
    const healerAdvisor = {
      modelId: () => 'healer-v1',
      generateAdvice: async (input) => {
        const strategy = infraManager.getStrategyForUrl(url);
        const availableCloud = strategy.providers.filter(p => p !== 'local');
        const cloudContext = availableCloud.length > 0 
          ? `\n\nYou can also suggest switching to one of these cloud providers if the site is blocking local traffic: ${availableCloud.join(', ')}.
If you want to switch, return ONLY this JSON: { "id": "infra-switch", "action": "switch_provider", "provider": "provider-name" }`
          : '';

        const prompt = `You are an expert browser automation healer. 
An operation failed: "${input.prompt}"
Error: "${error.message}"
Current Page URL: ${url}

Hypothesize a CSS selector to remove a blocking overlay or noise.
Return ONLY a valid JSON object matching AugmentationProfile schema:
{
  "id": "auto-fix-${Date.now()}",
  "urlPattern": "${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",
  "domMutations": { "remove": ["#the-blocking-selector"] }
}
${iclContext}${cloudContext}${visualContextText}`;

        const response = await generateAIResponse(
            this.ops.ctx.aiProvider.modelInstance,
            [{ role: 'user', content: prompt }],
            hasVisualImage
              ? { temperature: 0, purpose: 'healing', image: visualContext.image, mime: visualContext.mime }
              : { temperature: 0, purpose: 'healing' }
        );

        return {
          steering_text: response.content,
          metadata: { response: response.content }
        };
      }
    };

    // 3. Define fit Adapter (Execution of hypothesis)
    const executionAdapter = {
      call: async (prompt, advice) => {
        // The advice steering_text IS the new rule
        return { output: advice.steering_text, meta: {} };
      }
    };

    const scorer = new HealingScorer(page, targetLocator);
    const session = new Session(healerAdvisor, executionAdapter, scorer, {
      mode: 'multi-turn',
      maxSteps: 3,
      rewardThreshold: 1.0
    });

    try {
      const results = await session.run(instruction.prompt);
      const successfulStep = Array.isArray(results) ? results.find(r => r.reward.score === 1.0) : (results.reward.score === 1.0 ? results : null);

      if (successfulStep) {
        const rule = JSON.parse(successfulStep.output);
        logger.info('HealingService: found successful fix', { ruleId: rule.id });
        
        // Record for future Site B "intuition"
        await this.learningsStore.recordSuccess(signature, errorType, rule);
        
        return rule;
      }
    } catch (err) {
      logger.error('HealingService: session failed', { error: err.message });
    }

    return null;
  }
}
