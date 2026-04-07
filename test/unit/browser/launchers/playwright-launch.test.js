import { describe, it, expect, vi, beforeEach } from 'vitest';

const launchMock = vi.fn();

vi.mock('playwright', () => ({
  chromium: {
    launch: (...args) => launchMock(...args),
  },
}));

import { launch } from '../../../../src/browser/launchers/playwright-launch.js';

describe('playwright-launch.launch()', () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it('returns a BrowserHandle shape: { browser, context, close }', async () => {
    const fakeBrowser = { close: vi.fn().mockResolvedValue() };
    launchMock.mockResolvedValue(fakeBrowser);

    const handle = await launch({});
    expect(handle.browser).toBe(fakeBrowser);
    expect(handle.context).toBeNull();
    expect(typeof handle.close).toBe('function');
  });

  it('passes executablePath through to chromium.launch', async () => {
    const fakeBrowser = { close: vi.fn().mockResolvedValue() };
    launchMock.mockResolvedValue(fakeBrowser);

    await launch({ executablePath: '/opt/brave', launchOptions: { headless: true } });
    expect(launchMock).toHaveBeenCalledWith({ headless: true, executablePath: '/opt/brave' });
  });

  it('passes channel through to chromium.launch', async () => {
    const fakeBrowser = { close: vi.fn().mockResolvedValue() };
    launchMock.mockResolvedValue(fakeBrowser);

    await launch({ channel: 'chrome', launchOptions: { slowMo: 50 } });
    expect(launchMock).toHaveBeenCalledWith({ slowMo: 50, channel: 'chrome' });
  });

  it('does not include executablePath/channel when neither set', async () => {
    const fakeBrowser = { close: vi.fn().mockResolvedValue() };
    launchMock.mockResolvedValue(fakeBrowser);

    await launch({ launchOptions: { headless: false } });
    expect(launchMock).toHaveBeenCalledWith({ headless: false });
  });

  it('close() invokes browser.close()', async () => {
    const fakeBrowser = { close: vi.fn().mockResolvedValue() };
    launchMock.mockResolvedValue(fakeBrowser);

    const handle = await launch({});
    await handle.close();
    expect(fakeBrowser.close).toHaveBeenCalledOnce();
  });

  it('close() swallows errors from browser.close()', async () => {
    const fakeBrowser = { close: vi.fn().mockRejectedValue(new Error('boom')) };
    launchMock.mockResolvedValue(fakeBrowser);

    const handle = await launch({});
    await expect(handle.close()).resolves.toBeUndefined();
  });
});
