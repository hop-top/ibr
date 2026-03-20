/**
 * Unit tests for test/helpers/buildOperations.js
 *
 * Verifies that the default mode is 'dom' (not 'auto'), so integration tests
 * that return {x} index descriptors work correctly without extra config.
 */

import { describe, it, expect } from 'vitest';
import { buildOperations } from '../../helpers/buildOperations.js';

// We need a real URL — use one of the static test fixtures served by the
// static server, or simply use a data: URL so no network is needed.
const DATA_URL = 'data:text/html,<html><body><p>test</p></body></html>';

describe('buildOperations helper', () => {
  it('defaults mode to "dom" when no mode option supplied', async () => {
    const { operations, cleanup } = await buildOperations(DATA_URL);
    try {
      expect(operations.mode).toBe('dom');
    } finally {
      await cleanup();
    }
  });

  it('respects explicit mode override', async () => {
    const { operations, cleanup } = await buildOperations(DATA_URL, { mode: 'aria' });
    try {
      expect(operations.mode).toBe('aria');
    } finally {
      await cleanup();
    }
  });

  it('respects explicit mode="auto"', async () => {
    const { operations, cleanup } = await buildOperations(DATA_URL, { mode: 'auto' });
    try {
      expect(operations.mode).toBe('auto');
    } finally {
      await cleanup();
    }
  });

  it('regression: without the default, omitting mode would produce "auto" instead of "dom"', async () => {
    // The original Operations constructor defaults to 'auto'.
    // buildOperations must override to 'dom' so {x}-based integration tests pass.
    const { operations, cleanup } = await buildOperations(DATA_URL);
    try {
      expect(operations.mode).not.toBe('auto');
    } finally {
      await cleanup();
    }
  });
});
