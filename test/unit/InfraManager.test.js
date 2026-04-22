import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { InfraManager } from '../../src/browser/resolvers/InfraManager.js';

describe('InfraManager', () => {
  const testTmpDir = path.join(os.tmpdir(), `ibr-infra-test-${Date.now()}`);
  const configPath = path.join(testTmpDir, 'infra.json');

  beforeEach(async () => {
    await fs.mkdir(testTmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true });
  });

  it('should return default strategy if no policy matches', async () => {
    const manager = new InfraManager({ configPath });
    await manager.init();
    
    const strategy = manager.getStrategyForUrl('https://example.com');
    expect(strategy.providers).toEqual(['local']);
    expect(strategy.mode).toBe('sequential');
  });

  it('should return matching policy strategy', async () => {
    const config = {
      routing: {
        policies: [
          { urlPattern: 'jira\\.com', providers: ['browser-use'], stage: 'proactive' }
        ]
      }
    };
    await fs.writeFile(configPath, JSON.stringify(config));

    const manager = new InfraManager({ configPath });
    await manager.init();

    const strategy = manager.getStrategyForUrl('https://mycompany.jira.com/browse/PROJ-123');
    expect(strategy.providers).toEqual(['browser-use']);
    expect(strategy.stage).toBe('proactive');
  });

  it('should rotate accounts for a provider (Round-Robin)', async () => {
    const config = {
      providers: {
        'browser-use': {
          accounts: [
            { name: 'acc1', key: 'key1' },
            { name: 'acc2', key: 'key2' }
          ]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(config));

    const manager = new InfraManager({ configPath });
    await manager.init();

    const res1 = manager.resolveProvider('browser-use');
    const res2 = manager.resolveProvider('browser-use');
    const res3 = manager.resolveProvider('browser-use');

    expect(res1.account).toBe('acc1');
    expect(res1.wsEndpoint).toContain('key1');
    
    expect(res2.account).toBe('acc2');
    expect(res2.wsEndpoint).toContain('key2');
    
    expect(res3.account).toBe('acc1'); // back to first
  });
});
