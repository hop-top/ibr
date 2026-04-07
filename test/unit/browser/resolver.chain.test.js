import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';

const launchMock = vi.fn();
vi.mock('../../../src/browser/launchers/playwright-launch.js', () => ({
  launch: (...args) => launchMock(...args),
}));

import {
  resolve,
  resolveRecord,
  resolveProbeOnly,
  emitResolved,
} from '../../../src/browser/resolver.js';

let stderrSpy;
let platformSpy;

beforeEach(() => {
  launchMock.mockReset();
  launchMock.mockResolvedValue({
    browser: { close: vi.fn() },
    context: null,
    close: vi.fn(),
  });
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // Force darwin in the probe logic so these tests behave identically on
  // any CI host. The tests assert darwin-specific paths (Brave.app, etc).
  platformSpy = vi.spyOn(os, 'platform').mockReturnValue('darwin');
});

afterEach(() => {
  stderrSpy.mockRestore();
  platformSpy.mockRestore();
});

// ── Step 1: BROWSER_EXECUTABLE_PATH override ────────────────────────────────
describe('resolveRecord — exec-path override', () => {
  it('returns chromium-launch + exec-path source when env var set', () => {
    const { record, channelId } = resolveRecord({
      BROWSER_EXECUTABLE_PATH: '/custom/chrome',
    });
    expect(record.kind).toBe('chromium-launch');
    expect(record.source).toBe('exec-path');
    expect(record.executablePath).toBe('/custom/chrome');
    expect(channelId).toBeNull();
  });

  it('exec-path takes priority over BROWSER_CHANNEL', () => {
    const { record } = resolveRecord({
      BROWSER_EXECUTABLE_PATH: '/custom/chrome',
      BROWSER_CHANNEL: 'brave',
    });
    expect(record.source).toBe('exec-path');
    expect(record.executablePath).toBe('/custom/chrome');
  });
});

// ── Step 3: local probe ──────────────────────────────────────────────────────
describe('resolveRecord — local probe', () => {
  let existsSpy;

  beforeEach(() => {
    existsSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    existsSpy.mockRestore();
  });

  it('native channel (chrome) short-circuits to nativeChannel passthrough', () => {
    const { record, channelId } = resolveRecord({ BROWSER_CHANNEL: 'chrome' });
    expect(channelId).toBe('chrome');
    expect(record.source).toBe('probe');
    expect(record.channel).toBe('chrome');
    expect(record.executablePath).toBeNull();
  });

  it('native channel via alias (google-chrome → chrome)', () => {
    const { record, channelId } = resolveRecord({ BROWSER_CHANNEL: 'google-chrome' });
    expect(channelId).toBe('chrome');
    expect(record.channel).toBe('chrome');
  });

  it('native channel (msedge via alias edge)', () => {
    const { record } = resolveRecord({ BROWSER_CHANNEL: 'edge' });
    expect(record.channel).toBe('msedge');
  });

  it('non-native channel returns first matching probe path', () => {
    existsSpy.mockImplementation((p) =>
      p === '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    );

    const { record, channelId } = resolveRecord({ BROWSER_CHANNEL: 'brave' });
    expect(channelId).toBe('brave');
    expect(record.source).toBe('probe');
    expect(record.executablePath).toBe(
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    );
  });

  it('throws when channel is unknown', () => {
    expect(() => resolveRecord({ BROWSER_CHANNEL: 'firefox' })).toThrow(/not a known/);
  });

  it('throws with helpful message when no probe path matches', () => {
    existsSpy.mockReturnValue(false);
    expect(() => resolveRecord({ BROWSER_CHANNEL: 'brave' })).toThrow(/not found/);
  });
});

// ── Default fallback ─────────────────────────────────────────────────────────
describe('resolveRecord — default fallback', () => {
  it('returns chromium-launch with source=default when no env vars set', () => {
    const { record, channelId } = resolveRecord({});
    expect(record.kind).toBe('chromium-launch');
    expect(record.source).toBe('default');
    expect(record.executablePath).toBeNull();
    expect(record.channel).toBeNull();
    expect(channelId).toBeNull();
  });
});

// ── resolveProbeOnly (back-compat shim helper) ───────────────────────────────
describe('resolveProbeOnly', () => {
  it('returns {} for empty input', () => {
    expect(resolveProbeOnly(undefined)).toEqual({});
    expect(resolveProbeOnly('')).toEqual({});
  });

  it('returns { channel } for native channel', () => {
    expect(resolveProbeOnly('chrome')).toEqual({ channel: 'chrome' });
    expect(resolveProbeOnly('edge')).toEqual({ channel: 'msedge' });
  });

  it('returns { executablePath } for probed channel', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      p === '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    );
    try {
      expect(resolveProbeOnly('brave')).toEqual({
        executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      });
    } finally {
      existsSpy.mockRestore();
    }
  });

  // Regression for post-impl review finding C-1: resolveProbeOnly used to
  // crash with "Cannot read properties of null" when stepLocalProbe returned
  // null for a downloadable entry (lightpanda) with no local install.
  it('returns {} for downloadable channel with no local probe hit', () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    try {
      expect(resolveProbeOnly('lightpanda')).toEqual({});
      expect(resolveProbeOnly('panda')).toEqual({}); // alias
    } finally {
      existsSpy.mockRestore();
    }
  });
});

// ── emitResolved event shape ─────────────────────────────────────────────────
describe('emitResolved', () => {
  it('writes a single NDJSON line to stderr with the expected shape', () => {
    emitResolved(
      {
        kind: 'chromium-launch',
        source: 'exec-path',
        version: null,
        executablePath: '/x',
      },
      null
    );
    expect(stderrSpy).toHaveBeenCalledOnce();
    const line = stderrSpy.mock.calls[0][0];
    expect(line.endsWith('\n')).toBe(true);
    const obj = JSON.parse(line);
    expect(obj).toEqual({
      event: 'browser.resolved',
      channel: null,
      source: 'exec-path',
      version: null,
      kind: 'chromium-launch',
      executablePath: '/x',
    });
  });

  it('includes channel id when set, omits exec/ws fields when absent', () => {
    emitResolved(
      { kind: 'chromium-launch', source: 'probe', version: null, channel: 'chrome' },
      'chrome'
    );
    const obj = JSON.parse(stderrSpy.mock.calls[0][0]);
    expect(obj.channel).toBe('chrome');
    expect(obj.executablePath).toBeUndefined();
    expect(obj.wsEndpoint).toBeUndefined();
  });
});

// ── resolve() — full path → emits event + dispatches launcher ────────────────
describe('resolve() — chromium-launch dispatch', () => {
  it('calls playwright-launch.launch with merged overrides + emits event', async () => {
    const handle = await resolve(
      { BROWSER_EXECUTABLE_PATH: '/opt/brave' },
      { headless: true }
    );

    expect(launchMock).toHaveBeenCalledOnce();
    expect(launchMock).toHaveBeenCalledWith({
      executablePath: '/opt/brave',
      channel: undefined,
      launchOptions: { headless: true },
    });

    expect(stderrSpy).toHaveBeenCalledOnce();
    const evt = JSON.parse(stderrSpy.mock.calls[0][0]);
    expect(evt.event).toBe('browser.resolved');
    expect(evt.source).toBe('exec-path');

    expect(handle).toBeTruthy();
  });

  it('default fallback dispatches with no exec/channel', async () => {
    await resolve({}, { slowMo: 10 });
    expect(launchMock).toHaveBeenCalledWith({
      executablePath: undefined,
      channel: undefined,
      launchOptions: { slowMo: 10 },
    });
    const evt = JSON.parse(stderrSpy.mock.calls[0][0]);
    expect(evt.source).toBe('default');
  });
});
