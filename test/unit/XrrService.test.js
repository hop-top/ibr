import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XrrService } from '../../src/services/XrrService.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('XrrService', () => {
  const testTmpDir = path.join(os.tmpdir(), `ibr-xrr-test-${Date.now()}`);
  const cassetteDir = path.join(testTmpDir, 'cassettes');

  beforeEach(async () => {
    await fs.mkdir(cassetteDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testTmpDir, { recursive: true, force: true });
  });

  it('should record an AI call in record mode', async () => {
    const service = new XrrService({ mode: 'record', cassetteDir });
    const do_ = vi.fn().mockResolvedValue({ text: 'ai-response', usage: {} });

    const result = await service.recordAiCall(['msg'], { temp: 0 }, do_);

    expect(result.text).toBe('ai-response');
    expect(do_).toHaveBeenCalled();
    
    // Verify cassette files exist in dir
    const files = await fs.readdir(cassetteDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it('should replay an AI call from cassette in replay mode', async () => {
    // 1. Record first
    const recordService = new XrrService({ mode: 'record', cassetteDir });
    await recordService.recordAiCall(['msg'], { temp: 0 }, () => Promise.resolve({ text: 'cached', usage: {} }));

    // 2. Replay
    const replayService = new XrrService({ mode: 'replay', cassetteDir });
    const do_ = vi.fn();
    const result = await replayService.recordAiCall(['msg'], { temp: 0 }, do_);

    expect(result.text).toBe('cached');
    expect(do_).not.toHaveBeenCalled();
  });
});
