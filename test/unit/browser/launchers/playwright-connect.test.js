import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chromium } from 'playwright';
import {
  connect,
  _isValidWsEndpoint
} from '../../../../src/browser/launchers/playwright-connect.js';

vi.mock('playwright', () => ({
  chromium: {
    connectOverCDP: vi.fn()
  }
}));

/**
 * Build a fake Playwright Browser. `existingContexts` controls what
 * `browser.contexts()` returns.
 */
function makeFakeBrowser(existingContexts = []) {
  const newCtx = { _new: true };
  const browser = {
    contexts: vi.fn(() => existingContexts),
    newContext: vi.fn(async () => newCtx),
    close: vi.fn(async () => {})
  };
  return { browser, newCtx };
}

describe('playwright-connect / _isValidWsEndpoint', () => {
  it('accepts ws:// and wss:// strings', () => {
    expect(_isValidWsEndpoint('ws://127.0.0.1:9222')).toBe(true);
    expect(_isValidWsEndpoint('wss://example.com/cdp')).toBe(true);
    expect(_isValidWsEndpoint('ws://[::1]:9222')).toBe(true);
  });

  it('rejects falsy, non-string, and non-ws schemes', () => {
    expect(_isValidWsEndpoint('')).toBe(false);
    expect(_isValidWsEndpoint(null)).toBe(false);
    expect(_isValidWsEndpoint(undefined)).toBe(false);
    expect(_isValidWsEndpoint(0)).toBe(false);
    expect(_isValidWsEndpoint(123)).toBe(false);
    expect(_isValidWsEndpoint({})).toBe(false);
    expect(_isValidWsEndpoint('http://foo')).toBe(false);
    expect(_isValidWsEndpoint('https://foo')).toBe(false);
    expect(_isValidWsEndpoint('127.0.0.1:9222')).toBe(false);
  });
});

describe('playwright-connect / connect()', () => {
  let stderrSpy;

  beforeEach(() => {
    chromium.connectOverCDP.mockReset();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('happy path: connects with given URL and returns BrowserHandle', async () => {
    const { browser, newCtx } = makeFakeBrowser([]);
    chromium.connectOverCDP.mockResolvedValue(browser);

    const handle = await connect({ wsEndpoint: 'ws://127.0.0.1:9222' });

    expect(chromium.connectOverCDP).toHaveBeenCalledTimes(1);
    expect(chromium.connectOverCDP).toHaveBeenCalledWith('ws://127.0.0.1:9222');
    expect(handle.browser).toBe(browser);
    expect(handle.context).toBe(newCtx);
    expect(typeof handle.close).toBe('function');
  });

  it('reuses first existing context if browser already has one', async () => {
    const ctx1 = { _existing: 1 };
    const ctx2 = { _existing: 2 };
    const { browser } = makeFakeBrowser([ctx1, ctx2]);
    chromium.connectOverCDP.mockResolvedValue(browser);

    const handle = await connect({ wsEndpoint: 'ws://127.0.0.1:9222' });

    expect(handle.context).toBe(ctx1);
    expect(browser.newContext).not.toHaveBeenCalled();
  });

  it('creates new context with contextOptions when none exist', async () => {
    const { browser, newCtx } = makeFakeBrowser([]);
    chromium.connectOverCDP.mockResolvedValue(browser);
    const contextOptions = { viewport: { width: 800, height: 600 } };

    const handle = await connect({
      wsEndpoint: 'ws://127.0.0.1:9222',
      contextOptions
    });

    expect(browser.newContext).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledWith(contextOptions);
    expect(handle.context).toBe(newCtx);
  });

  it('close() calls browser.close() exactly once', async () => {
    const { browser } = makeFakeBrowser([]);
    chromium.connectOverCDP.mockResolvedValue(browser);

    const handle = await connect({ wsEndpoint: 'ws://127.0.0.1:9222' });
    await handle.close();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['http url', 'http://foo'],
    ['bare host:port', '127.0.0.1:9222']
  ])('throws on invalid wsEndpoint (%s) without calling connectOverCDP', async (_label, value) => {
    await expect(connect({ wsEndpoint: value })).rejects.toThrow(
      /invalid wsEndpoint/
    );
    expect(chromium.connectOverCDP).not.toHaveBeenCalled();
  });

  it.each([
    'ws://127.0.0.1:9222',
    'wss://example.com/cdp',
    'ws://[::1]:9222'
  ])('accepts valid ws endpoint: %s', async (url) => {
    const { browser } = makeFakeBrowser([]);
    chromium.connectOverCDP.mockResolvedValue(browser);

    await connect({ wsEndpoint: url });

    expect(chromium.connectOverCDP).toHaveBeenCalledWith(url);
  });

  it('emits NDJSON browser.connected event on success (reusedContext=false)', async () => {
    const { browser } = makeFakeBrowser([]);
    chromium.connectOverCDP.mockResolvedValue(browser);

    await connect({ wsEndpoint: 'ws://127.0.0.1:9222' });

    expect(stderrSpy).toHaveBeenCalled();
    // Find the browser.connected line.
    const lines = stderrSpy.mock.calls.map((c) => c[0]);
    const evtLine = lines.find((l) => typeof l === 'string' && l.includes('browser.connected'));
    expect(evtLine).toBeDefined();
    expect(evtLine.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(evtLine.trim());
    expect(parsed).toEqual({
      event: 'browser.connected',
      wsEndpoint: 'ws://127.0.0.1:9222',
      reusedContext: false,
      contextsOnConnect: 0
    });
  });

  it('emits NDJSON browser.connected event on success (reusedContext=true)', async () => {
    const ctx1 = { _existing: 1 };
    const { browser } = makeFakeBrowser([ctx1]);
    chromium.connectOverCDP.mockResolvedValue(browser);

    await connect({ wsEndpoint: 'wss://example.com/cdp' });

    const lines = stderrSpy.mock.calls.map((c) => c[0]);
    const evtLine = lines.find((l) => typeof l === 'string' && l.includes('browser.connected'));
    expect(evtLine).toBeDefined();
    const parsed = JSON.parse(evtLine.trim());
    expect(parsed).toEqual({
      event: 'browser.connected',
      wsEndpoint: 'wss://example.com/cdp',
      reusedContext: true,
      contextsOnConnect: 1
    });
  });
});
