/**
 * Unit tests for parseCookiesFlag + getOperationOptions — high-precision errors (T-0013)
 *
 * Both functions are pure/environment-dependent parsers; index.js side-effects
 * (calling run()) are avoided by importing named exports only.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// Prevent index.js from calling run() on import — mock the entry-point side effect
// by stubbing the modules it depends on before importing.
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));
vi.mock('../../src/ai/provider.js', () => ({ createAIProvider: vi.fn() }));
vi.mock('../../src/Operations.js', () => ({ Operations: vi.fn() }));
vi.mock('../../src/utils/validation.js', () => ({
  validateEnvironmentVariables: vi.fn(),
  validateBrowserConfig: vi.fn(c => c),
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/utils/cookieImport.js', () => ({ importCookies: vi.fn() }));
vi.mock('../../src/commands/snap.js', () => ({ runDomCommand: vi.fn() }));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

// Stub process.exit so run() calling process.exit(0) for --help doesn't cause
// vitest to report an unhandled error when tests run in the full suite.
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

// Prevent the immediate run() call by overriding process.argv before import
const origArgv = process.argv;
process.argv = ['node', 'src/index.js', '--help'];

const { parseCookiesFlag, getOperationOptions } = await import('../../src/index.js');

process.argv = origArgv;
// Restore exit after module is loaded; individual tests do not need it suppressed
exitSpy.mockRestore();

// ── parseCookiesFlag ──────────────────────────────────────────────────────────

describe('parseCookiesFlag — high-precision errors', () => {
  it('returns null when --cookies flag absent', () => {
    expect(parseCookiesFlag(['node', 'ibr', 'some prompt'])).toBeNull();
  });

  it('throws when --cookies has no value', () => {
    expect(() => parseCookiesFlag(['node', 'ibr', '--cookies']))
      .toThrow('--cookies flag requires a value');
  });

  it('error includes Usage hint', () => {
    expect(() => parseCookiesFlag(['node', 'ibr', '--cookies']))
      .toThrow('Usage: --cookies <browser>[:<domain1>,<domain2>]');
  });

  it('error includes Example', () => {
    expect(() => parseCookiesFlag(['node', 'ibr', '--cookies']))
      .toThrow('Example: --cookies chrome  or  --cookies arc:github.com,linear.app');
  });

  it('error lists supported browsers', () => {
    expect(() => parseCookiesFlag(['node', 'ibr', '--cookies']))
      .toThrow('Supported browsers: chrome, arc, brave, edge, comet');
  });

  it('throws when --cookies value is another flag', () => {
    expect(() => parseCookiesFlag(['node', 'ibr', '--cookies', '--mode']))
      .toThrow('--cookies flag requires a value');
  });

  it('returns browser with empty domains when no colon', () => {
    const result = parseCookiesFlag(['node', 'ibr', '--cookies', 'chrome']);
    expect(result).toEqual({ browser: 'chrome', domains: [] });
  });

  it('parses browser + domains from colon-separated value', () => {
    const result = parseCookiesFlag(['node', 'ibr', '--cookies', 'arc:github.com,linear.app']);
    expect(result).toEqual({ browser: 'arc', domains: ['github.com', 'linear.app'] });
  });
});

// ── getOperationOptions ───────────────────────────────────────────────────────

describe('getOperationOptions — AI_TEMPERATURE validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses default temperature 0 when AI_TEMPERATURE unset', () => {
    vi.stubEnv('AI_TEMPERATURE', '');
    const opts = getOperationOptions('auto');
    expect(opts.temperature).toBe(0);
  });

  it('parses valid AI_TEMPERATURE=1', () => {
    vi.stubEnv('AI_TEMPERATURE', '1');
    const opts = getOperationOptions('auto');
    expect(opts.temperature).toBe(1);
  });

  it('throws when AI_TEMPERATURE is NaN — includes "got:" in message', () => {
    vi.stubEnv('AI_TEMPERATURE', 'hot');
    expect(() => getOperationOptions('auto')).toThrow('AI_TEMPERATURE must be a number between 0 and 2');
  });

  it('AI_TEMPERATURE error includes the bad value', () => {
    vi.stubEnv('AI_TEMPERATURE', 'hot');
    expect(() => getOperationOptions('auto')).toThrow('got: hot');
  });

  it('AI_TEMPERATURE error includes remediation hint', () => {
    vi.stubEnv('AI_TEMPERATURE', 'hot');
    expect(() => getOperationOptions('auto')).toThrow('AI_TEMPERATURE=0 for deterministic outputs');
  });

  it('throws when AI_TEMPERATURE is negative', () => {
    vi.stubEnv('AI_TEMPERATURE', '-1');
    expect(() => getOperationOptions('auto')).toThrow('AI_TEMPERATURE must be a number between 0 and 2');
  });

  it('throws when AI_TEMPERATURE exceeds 2', () => {
    vi.stubEnv('AI_TEMPERATURE', '3');
    expect(() => getOperationOptions('auto')).toThrow('AI_TEMPERATURE must be a number between 0 and 2');
  });

  it('accepts boundary value 0', () => {
    vi.stubEnv('AI_TEMPERATURE', '0');
    expect(() => getOperationOptions('auto')).not.toThrow();
  });

  it('accepts boundary value 2', () => {
    vi.stubEnv('AI_TEMPERATURE', '2');
    expect(() => getOperationOptions('auto')).not.toThrow();
  });

  it('passes mode through to options', () => {
    vi.stubEnv('AI_TEMPERATURE', '0');
    const opts = getOperationOptions('aria');
    expect(opts.mode).toBe('aria');
  });
});
