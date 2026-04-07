/**
 * Unit tests for src/commands/browser/list.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const registryMock = vi.hoisted(() => ({
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  NATIVE_CHANNELS: new Set(['chrome', 'msedge']),
  canonicalizeChannel: (s) => s,
}));

const cacheMock = vi.hoisted(() => ({
  listVersions: vi.fn(),
}));

vi.mock('../../../../src/browser/registry.js', () => registryMock);
vi.mock('../../../../src/browser/cache.js', () => cacheMock);

let listCmd;
let stdoutSpy;
let stderrSpy;

beforeEach(async () => {
  vi.resetModules();
  registryMock.listEntries.mockReset();
  registryMock.getEntry.mockReset();
  cacheMock.listVersions.mockReset();
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  listCmd = await import('../../../../src/commands/browser/list.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setupRegistry(entries) {
  registryMock.listEntries.mockReturnValue(entries.map((e) => e.id));
  registryMock.getEntry.mockImplementation((id) => entries.find((e) => e.id === id) || null);
}

describe('browser list', () => {
  it('renders a text table by default', async () => {
    setupRegistry([
      {
        id: 'lightpanda',
        kind: 'cdp-server',
        downloadable: true,
        localProbe: { [process.platform]: ['/a', '/b'] },
      },
      {
        id: 'chrome',
        kind: 'chromium-launch',
        nativeChannel: 'chrome',
        downloadable: false,
        localProbe: { [process.platform]: [] },
      },
    ]);
    cacheMock.listVersions.mockImplementation(async (id) =>
      id === 'lightpanda' ? [{ version: '0.2.8' }, { version: '0.2.7' }] : [],
    );

    const code = await listCmd.run([]);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('ID');
    expect(out).toContain('Kind');
    expect(out).toContain('lightpanda');
    expect(out).toContain('cdp-server');
    expect(out).toContain('yes');
    expect(out).toContain('0.2.8,0.2.7');
    expect(out).toContain('chrome');
    expect(out).toContain('native');
  });

  it('emits JSON with --json', async () => {
    setupRegistry([
      {
        id: 'lightpanda',
        kind: 'cdp-server',
        downloadable: true,
        localProbe: { [process.platform]: ['/a'] },
      },
    ]);
    cacheMock.listVersions.mockResolvedValue([{ version: '0.2.8' }]);

    const code = await listCmd.run(['--json']);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({
      id: 'lightpanda',
      kind: 'cdp-server',
      downloadable: true,
      cachedVersions: ['0.2.8'],
    });
  });

  it('prints help with --help and exits 0', async () => {
    const code = await listCmd.run(['--help']);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('Usage: ibr browser list');
  });

  it('survives cache.listVersions errors', async () => {
    setupRegistry([
      {
        id: 'brave',
        kind: 'chromium-launch',
        downloadable: false,
        localProbe: { [process.platform]: ['/x'] },
      },
    ]);
    cacheMock.listVersions.mockRejectedValue(new Error('boom'));
    const code = await listCmd.run([]);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('brave');
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
