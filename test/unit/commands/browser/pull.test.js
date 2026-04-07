/**
 * Unit tests for src/commands/browser/pull.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const registryMock = vi.hoisted(() => ({
  listEntries: vi.fn(() => ['lightpanda', 'chrome']),
  getEntry: vi.fn(),
  canonicalizeChannel: vi.fn((s) => (s === 'panda' ? 'lightpanda' : s)),
  NATIVE_CHANNELS: new Set(['chrome']),
}));

const acquirerMock = vi.hoisted(() => ({
  acquire: vi.fn(),
}));

vi.mock('../../../../src/browser/registry.js', () => registryMock);
vi.mock('../../../../src/browser/acquirer.js', () => acquirerMock);

let pullCmd;
let stdoutSpy;
let stderrSpy;

beforeEach(async () => {
  vi.resetModules();
  acquirerMock.acquire.mockReset();
  registryMock.getEntry.mockReset();
  registryMock.canonicalizeChannel.mockClear();
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  pullCmd = await import('../../../../src/commands/browser/pull.js');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const downloadableEntry = {
  id: 'lightpanda',
  downloadable: true,
  kind: 'cdp-server',
};

const nonDownloadableEntry = {
  id: 'chrome',
  downloadable: false,
  kind: 'chromium-launch',
};

describe('browser pull', () => {
  it('prints help with --help', async () => {
    const code = await pullCmd.run(['--help']);
    expect(code).toBe(0);
    expect(stdoutSpy.mock.calls.join('')).toContain('Usage: ibr browser pull');
  });

  it('errors with code 2 when channel missing', async () => {
    registryMock.getEntry.mockImplementation((id) =>
      id === 'lightpanda' ? downloadableEntry : null,
    );
    const code = await pullCmd.run([]);
    expect(code).toBe(2);
    expect(stderrSpy.mock.calls.join('')).toContain('missing <channel>');
    expect(stderrSpy.mock.calls.join('')).toContain('lightpanda');
  });

  it('errors with code 4 on unknown channel', async () => {
    registryMock.getEntry.mockReturnValue(null);
    const code = await pullCmd.run(['nope']);
    expect(code).toBe(4);
    expect(stderrSpy.mock.calls.join('')).toContain('unknown channel');
  });

  it('errors with code 2 on non-downloadable channel', async () => {
    registryMock.getEntry.mockImplementation((id) =>
      id === 'chrome' ? nonDownloadableEntry : null,
    );
    const code = await pullCmd.run(['chrome']);
    expect(code).toBe(2);
    expect(stderrSpy.mock.calls.join('')).toContain('not downloadable');
  });

  it('happy path: download success → exit 0 + summary line', async () => {
    registryMock.getEntry.mockReturnValue(downloadableEntry);
    acquirerMock.acquire.mockResolvedValue({
      source: 'download',
      version: '0.2.8',
      executablePath: '/cache/lightpanda/0.2.8/bin/lightpanda',
    });
    const code = await pullCmd.run(['lightpanda']);
    expect(code).toBe(0);
    expect(acquirerMock.acquire).toHaveBeenCalledWith(
      downloadableEntry,
      expect.objectContaining({ version: 'stable' }),
    );
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('pulled lightpanda@0.2.8');
    expect(out).toContain('/cache/lightpanda/0.2.8/bin/lightpanda');
  });

  it('passes version positional through to acquirer', async () => {
    registryMock.getEntry.mockReturnValue(downloadableEntry);
    acquirerMock.acquire.mockResolvedValue({
      source: 'cache',
      version: '0.2.7',
      executablePath: '/cache/x',
    });
    await pullCmd.run(['lightpanda', '0.2.7']);
    expect(acquirerMock.acquire).toHaveBeenCalledWith(
      downloadableEntry,
      expect.objectContaining({ version: '0.2.7' }),
    );
  });

  it('reports probe-hit as "local install found"', async () => {
    registryMock.getEntry.mockReturnValue(downloadableEntry);
    acquirerMock.acquire.mockResolvedValue({
      source: 'probe',
      version: 'local',
      executablePath: '/usr/local/bin/lightpanda',
    });
    const code = await pullCmd.run(['lightpanda']);
    expect(code).toBe(0);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    expect(out).toContain('local install found');
    expect(out).toContain('/usr/local/bin/lightpanda');
  });

  it('--json emits structured event line on success', async () => {
    registryMock.getEntry.mockReturnValue(downloadableEntry);
    acquirerMock.acquire.mockResolvedValue({
      source: 'download',
      version: '0.2.8',
      executablePath: '/cache/x',
    });
    await pullCmd.run(['lightpanda', 'stable', '--json']);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(out.trim());
    expect(parsed).toMatchObject({
      event: 'browser.pull.complete',
      channel: 'lightpanda',
      version: '0.2.8',
      source: 'download',
    });
  });

  it('exit code 3 on acquirer failure', async () => {
    registryMock.getEntry.mockReturnValue(downloadableEntry);
    acquirerMock.acquire.mockRejectedValue(new Error('network down'));
    const code = await pullCmd.run(['lightpanda']);
    expect(code).toBe(3);
    expect(stderrSpy.mock.calls.join('')).toContain('failed to acquire');
    expect(stderrSpy.mock.calls.join('')).toContain('network down');
  });
});
