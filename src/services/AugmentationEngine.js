import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import logger from '../utils/logger.js';

const DEFAULT_FILE_PATH = path.join(os.homedir(), '.ibr', 'augmentations.json');
const FAILURE_THRESHOLD = 3;

/**
 * AugmentationEngine — intercept URLs and apply domain-specific rules (DOM mutations, scripts).
 * Rules are loaded from ~/.ibr/augmentations.json.
 */
export class AugmentationEngine {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.filePath] - Override path to augmentations.json
   */
  constructor(opts = {}) {
    this.filePath = opts.filePath || process.env.IBR_AUGMENTATIONS_FILE || DEFAULT_FILE_PATH;
    this.rules = [];
    this.initialized = false;
  }

  /**
   * Initialize engine by loading rules from disk.
   */
  async init() {
    if (this.initialized) return;

    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const store = JSON.parse(data);
      this.rules = Array.isArray(store.rules) ? store.rules : [];
      this.initialized = true;
      logger.debug('AugmentationEngine initialized', { 
        filePath: this.filePath, 
        ruleCount: this.rules.length 
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.debug('AugmentationEngine: no augmentations file found, starting empty', { 
          path: this.filePath 
        });
        this.rules = [];
        this.initialized = true;
      } else {
        logger.warn('AugmentationEngine: failed to load rules', { error: err.message });
        this.rules = [];
      }
    }
  }

  /**
   * Get matching rules for a given URL, sorted by priority.
   * @param {string} url
   * @returns {Array} Matching rules
   */
  getRulesForUrl(url) {
    if (!url) return [];

    const matches = this.rules.filter(rule => {
      // Skip rules with too many failure votes
      if ((rule.telemetry?.failureVotes || 0) >= FAILURE_THRESHOLD) {
        return false;
      }

      try {
        const regex = new RegExp(rule.urlPattern);
        return regex.test(url);
      } catch (err) {
        logger.warn('AugmentationEngine: invalid urlPattern regex', { 
          ruleId: rule.id, 
          pattern: rule.urlPattern 
        });
        return false;
      }
    });

    // Sort by priority descending (higher numbers first)
    return matches.sort((a, b) => (b.priority || 100) - (a.priority || 100));
  }

  /**
   * Record a failure vote for a rule.
   * @param {string} ruleId
   */
  async recordFailure(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return;

    if (!rule.telemetry) rule.telemetry = { failureVotes: 0 };
    rule.telemetry.failureVotes = (rule.telemetry.failureVotes || 0) + 1;
    rule.telemetry.lastFailureAt = new Date().toISOString();

    await this.save();
    logger.info('AugmentationEngine: recorded failure vote for rule', { 
      ruleId, 
      votes: rule.telemetry.failureVotes 
    });
  }

  /**
   * Record a success for a rule (resets failure votes).
   * @param {string} ruleId
   */
  async recordSuccess(ruleId) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return;

    if (rule.telemetry) {
      rule.telemetry.failureVotes = 0;
      rule.telemetry.lastVerified = new Date().toISOString();
      await this.save();
    }
  }

  /**
   * Add or update a rule permanently.
   * @param {Object} rule
   */
  async upsertRule(rule) {
    if (!rule.id || !rule.urlPattern) {
      throw new Error('AugmentationEngine: rule must have id and urlPattern');
    }

    const idx = this.rules.findIndex(r => r.id === rule.id);
    if (idx !== -1) {
      this.rules[idx] = { ...this.rules[idx], ...rule };
    } else {
      this.rules.push(rule);
    }

    await this.save();
  }

  /**
   * Save current rules to disk.
   */
  async save() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const store = { version: 1, rules: this.rules };
      await fs.writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
      logger.error('AugmentationEngine: failed to save rules', { error: err.message });
    }
  }
}

export const augmentationEngine = new AugmentationEngine();
