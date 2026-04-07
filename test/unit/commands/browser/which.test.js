/**
 * Unit tests for src/commands/browser/which.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const resolverMock = vi.hoisted(() => ({
  resolveRecord: vi.fn(),
}));

vi.mock('../../../../src/browser/resolver.js', () => resolverMock);

let whichCmd;
let stdoutSpy;
let origEnv;

beforeEach(async () => {
  vi.resetModules();
  resolverMock.resolveRecord.mockReset();
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  whichCmd = await import('../../../../src/commands/browser/which.js');
  origEnv = { ...process.env };
  delete process.env.BROWSER_CHANNEL;
  delete process.env.BROWSER_CDP_URL;
  delete process.env.LIGHTPANDA_WS;
  delete process.env.BROWSER_EXECUTABLE_PATH;
  delete process.env.BROWSER_VERSION;
  delete process.env.BROWSER_DOWNLOAD_URL;
});

afterEach(() => {
  process.env = origEnv;
  vi.restoreAllMocks();
});

describe('browser which', () => {
  it('prints help with --help', async () => {
    const code = await whichCmd.run(['--help']);
    expect(code).toBe(0);
    expect(stdoutSpy.mock.calls.join('')).toContain('Usage: ibr browser which');
    expect(resolverMock.resolveRecord).not.toHaveBeenCalled();
  });

  it('prints text record with channel/kind/source/path', async () => {
    resolverMock.resolveRecord.mockReturnValue({
      record: {
        kind: 'cdp-server',
        source: 'cache',
        version: '0.2.8',
        executablePath: '/cache/lightpanda/0.2.8/bin/lightpanda',
        channel: 'lightpanda',
      },
      channelId: 'lightpanda',
    });
    process.env.BROWSER_CHANNEL = 'lightpanda';
    const code = await whichCmd.run([]);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('channel: lightpanda');
    expect(out).toContain('kind: cdp-server');
    expect(out).toContain('source: cache');
    expect(out).toContain('version: 0.2.8');
    expect(out).toContain('executablePath: /cache/lightpanda/0.2.8/bin/lightpanda');
    expect(out).toContain('BROWSER_CHANNEL=lightpanda');
  });

  it('handles wsEndpoint records', async () => {
    resolverMock.resolveRecord.mockReturnValue({
      record: {
        kind: 'cdp-server',
        source: 'cdp-url',
        version: null,
        wsEndpoint: 'ws://localhost:9222',
        channel: 'lightpanda',
      },
      channelId: 'lightpanda',
    });
    process.env.BROWSER_CDP_URL = 'ws://localhost:9222';
    await whichCmd.run([]);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('wsEndpoint: ws://localhost:9222');
    expect(out).toContain('BROWSER_CDP_URL=ws://localhost:9222');
  });

  it('handles __needs_acquire__ sentinel', async () => {
    resolverMock.resolveRecord.mockReturnValue({
      record: {
        kind: '__needs_acquire__',
        entry: { id: 'lightpanda', kind: 'cdp-server', downloadable: true },
        channelId: 'lightpanda',
      },
      channelId: 'lightpanda',
    });
    process.env.BROWSER_CHANNEL = 'lightpanda';
    const code = await whichCmd.run([]);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('would download via acquirer');
    expect(out).toContain('registry.id: lightpanda');
  });

  it('--json emits JSON document', async () => {
    resolverMock.resolveRecord.mockReturnValue({
      record: {
        kind: 'chromium-launch',
        source: 'default',
        version: null,
        executablePath: null,
        channel: null,
      },
      channelId: null,
    });
    const code = await whichCmd.run(['--json']);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty('record');
    expect(parsed).toHaveProperty('env');
    expect(parsed.record.kind).toBe('chromium-launch');
  });

  it('reports "(none)" when no relevant env set', async () => {
    resolverMock.resolveRecord.mockReturnValue({
      record: {
        kind: 'chromium-launch',
        source: 'default',
        version: null,
      },
      channelId: null,
    });
    await whichCmd.run([]);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('channel: (none)');
    expect(out).toContain('none of BROWSER_CHANNEL');
  });
});
