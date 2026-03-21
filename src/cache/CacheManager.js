/**
 * Simple file-based cache manager for extraction schemas
 * Stores and retrieves cached extraction methods to avoid repeated AI calls
 * Respects XDG Base Directory specification
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import logger from '../utils/logger.js';

const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';
const MAX_FAILURES = parseInt(process.env.CACHE_MAX_FAILURES || '3');

/**
 * Determine cache directory based on XDG or OS defaults
 */
function getCacheDir() {
  // Explicit override
  if (process.env.CACHE_DIR) {
    return process.env.CACHE_DIR;
  }

  // XDG Base Directory
  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, 'ibr');
  }

  // OS defaults
  const home = os.homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS: ~/Library/Caches
    return path.join(home, 'Library', 'Caches', 'ibr');
  } else if (platform === 'win32') {
    // Windows: %LOCALAPPDATA%
    return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ibr', 'cache');
  } else {
    // Linux/Unix: ~/.cache
    return path.join(home, '.cache', 'ibr');
  }
}

const CACHE_DIR = getCacheDir();

export class CacheManager {
  constructor() {
    this.enabled = CACHE_ENABLED;
    this.cacheDir = path.resolve(CACHE_DIR);
    this.initialized = false;
  }

  /**
   * Initialize cache directory
   */
  async init() {
    if (!this.enabled || this.initialized) return;

    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      for (const type of ['find', 'action', 'extract']) {
        await fs.mkdir(path.join(this.cacheDir, type), { recursive: true });
      }
      this.initialized = true;
      logger.debug('Cache manager initialized', { cacheDir: this.cacheDir });
    } catch (error) {
      logger.warn('Failed to initialize cache', { error: error.message });
      this.enabled = false;
    }
  }

  /**
   * Generate cache key from URL, prompt, and type
   */
  generateKey(url, prompt, type) {
    const normalized = `${this._normalizeUrl(url)}:${type}:${this._normalizePrompt(prompt)}`;
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Get cached entry
   */
  async get(type, cacheKey) {
    if (!this.enabled || !this.initialized) return null;

    try {
      const filePath = path.join(this.cacheDir, type, `${cacheKey}.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      const entry = JSON.parse(content);

      // Check if too many failures
      if (entry.metadata.failureCount >= MAX_FAILURES) {
        logger.debug('Cache entry invalidated by failures', { cacheKey: cacheKey.substring(0, 8) });
        await this._delete(type, cacheKey);
        return null;
      }

      return entry;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.debug('Cache read error', { error: error.message });
        // Delete corrupted cache file
        try {
          await this._delete(type, cacheKey);
        } catch (e) {
          // Ignore delete errors
        }
      }
      return null;
    }
  }

  /**
   * Set cached entry
   */
  async set(type, cacheKey, entry) {
    if (!this.enabled || !this.initialized) return;

    try {
      const filePath = path.join(this.cacheDir, type, `${cacheKey}.json`);
      const data = {
        ...entry,
        metadata: {
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          successCount: 0,
          failureCount: 0,
          ...entry.metadata
        }
      };
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      logger.debug('Cache entry created', { type, cacheKey: cacheKey.substring(0, 8) });
    } catch (error) {
      logger.debug('Cache write error', { error: error.message });
    }
  }

  /**
   * Record successful cache usage
   */
  async recordSuccess(type, cacheKey) {
    if (!this.enabled || !this.initialized) return;

    try {
      const entry = await this.get(type, cacheKey);
      if (entry) {
        entry.metadata.successCount++;
        entry.metadata.lastUsedAt = new Date().toISOString();
        const filePath = path.join(this.cacheDir, type, `${cacheKey}.json`);
        await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
      }
    } catch (error) {
      logger.debug('Failed to record cache success', { error: error.message });
    }
  }

  /**
   * Record cache miss/failure
   */
  async recordFailure(type, cacheKey) {
    if (!this.enabled || !this.initialized) return;

    try {
      const entry = await this.get(type, cacheKey);
      if (entry) {
        entry.metadata.failureCount++;
        const filePath = path.join(this.cacheDir, type, `${cacheKey}.json`);
        await fs.writeFile(filePath, JSON.stringify(entry, null, 2));

        if (entry.metadata.failureCount >= MAX_FAILURES) {
          logger.debug('Cache entry invalidated', { cacheKey: cacheKey.substring(0, 8) });
          await this._delete(type, cacheKey);
        }
      }
    } catch (error) {
      logger.debug('Failed to record cache failure', { error: error.message });
    }
  }

  /**
   * Delete cache entry
   */
  async _delete(type, cacheKey) {
    try {
      const filePath = path.join(this.cacheDir, type, `${cacheKey}.json`);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore delete errors
    }
  }

  /**
   * Normalize URL for consistent caching
   */
  _normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      // Keep origin and path, remove query/fragment
      return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  /**
   * Normalize prompt for consistent caching
   */
  _normalizePrompt(prompt) {
    return prompt
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s-]/g, '');
  }

  /**
   * Clear all cache
   */
  async clearAll() {
    if (!this.initialized) return;

    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      await this.init();
      logger.info('Cache cleared');
    } catch (error) {
      logger.warn('Failed to clear cache', { error: error.message });
    }
  }

  /**
   * Get cache stats
   */
  async getStats() {
    if (!this.initialized) return null;

    try {
      let totalEntries = 0;
      let totalSize = 0;

      for (const type of ['find', 'action', 'extract']) {
        const typeDir = path.join(this.cacheDir, type);
        const files = await fs.readdir(typeDir);

        for (const file of files) {
          totalEntries++;
          const filePath = path.join(typeDir, file);
          const stat = await fs.stat(filePath);
          totalSize += stat.size;
        }
      }

      return {
        enabled: this.enabled,
        cacheDir: this.cacheDir,
        totalEntries,
        totalSize: `${(totalSize / 1024).toFixed(2)} KB`
      };
    } catch (error) {
      logger.debug('Failed to get cache stats', { error: error.message });
      return null;
    }
  }
}

export default CacheManager;
