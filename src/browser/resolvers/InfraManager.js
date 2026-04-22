import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import logger from '../../utils/logger.js';
import { getEntry } from '../registry.js';

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.ibr', 'infra.json');

/**
 * InfraManager — manages Multi-Provider Cloud Orchestration.
 * Handles account pooling, key rotation, and routing policies.
 */
export class InfraManager {
  constructor(opts = {}) {
    this.configPath = opts.configPath || process.env.IBR_INFRA_CONFIG || DEFAULT_CONFIG_PATH;
    this.config = {
      providers: {},
      routing: {
        default: 'local',
        policies: []
      }
    };
    this.indices = {}; // Track rotation index per provider
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(data);
      logger.debug('InfraManager: config loaded', { path: this.configPath });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn('InfraManager: failed to load config', { error: err.message });
      }
    }
    this.initialized = true;
  }

  /**
   * Get the strategy for a given URL.
   * Returns { mode: 'sequential'|'concurrent', providers: string[], stage: 'proactive'|'reactive' }
   */
  getStrategyForUrl(url) {
    if (!url) return { mode: 'sequential', providers: ['local'], stage: 'proactive' };

    const policy = this.config.routing?.policies?.find(p => {
      try {
        return new RegExp(p.urlPattern).test(url);
      } catch {
        return false;
      }
    });

    if (policy) {
      return {
        mode: policy.mode || 'sequential',
        providers: policy.providers || ['local'],
        stage: policy.stage || 'proactive'
      };
    }

    return {
      mode: 'sequential',
      providers: [this.config.routing?.default || 'local'],
      stage: 'proactive'
    };
  }

  /**
   * Resolve a provider name to a connection string using key rotation.
   */
  resolveProvider(providerId) {
    if (providerId === 'local') return { kind: 'local' };

    const entry = getEntry(providerId);
    if (!entry || entry.kind !== 'cloud-server') {
      return null;
    }

    const providerConfig = this.config.providers[providerId];
    if (!providerConfig || !providerConfig.accounts || providerConfig.accounts.length === 0) {
      logger.warn(`InfraManager: no accounts configured for ${providerId}`);
      return null;
    }

    // Round-robin rotation
    if (this.indices[providerId] === undefined) this.indices[providerId] = 0;
    const account = providerConfig.accounts[this.indices[providerId]];
    this.indices[providerId] = (this.indices[providerId] + 1) % providerConfig.accounts.length;

    const wsEndpoint = entry.urlTemplate.replace('{{key}}', account.key);

    return {
      kind: 'cloud-server',
      id: providerId,
      account: account.name,
      wsEndpoint,
      launcher: entry.launcher
    };
  }
}

export const infraManager = new InfraManager();
