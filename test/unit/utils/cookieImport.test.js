/**
 * Regression tests for Copilot review fixes in cookieImport.js
 *
 * Fixes covered:
 *   1. Keychain timeout — execFileSync SIGTERM/ETIMEDOUT → CookieImportError('keychain_timeout')
 *   2. assertMacOS() — non-darwin platform → CookieImportError('unsupported_platform')
 *   3. Domain filter expansion — bare domain auto-expands to include leading-dot variant
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock child_process before any import of cookieImport ────────────────────
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

// ─── Mock fs so getCookieDbPath doesn't need real files ──────────────────────
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// ─── Mock better-sqlite3 ─────────────────────────────────────────────────────
vi.mock('better-sqlite3', () => {
  const mockStmt = {
    all: vi.fn(() => []),
  };
  const mockDb = {
    prepare: vi.fn(() => mockStmt),
    close: vi.fn(),
  };
  return { default: vi.fn(() => mockDb) };
});

import { execFileSync } from 'child_process';

// Re-import after mocks are in place
async function loadModule() {
  vi.resetModules();
  return import('../../../src/utils/cookieImport.js?t=' + Date.now());
}

describe('cookieImport — Copilot review regression tests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Fix 1: keychain timeout ────────────────────────────────────────────────

  describe('getKeychainPassword — keychain_timeout', () => {
    it('maps SIGTERM to CookieImportError with code=keychain_timeout', async () => {
      const sigtermErr = Object.assign(new Error('spawnSync security ETIMEDOUT'), {
        signal: 'SIGTERM',
        stderr: '',
        code: undefined,
      });
      execFileSync.mockImplementation(() => { throw sigtermErr; });

      // Stub platform to darwin so assertMacOS() passes
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const { importCookies, CookieImportError } = await loadModule();

      await expect(importCookies('chrome', [])).rejects.toSatisfy((err) =>
        err instanceof CookieImportError && err.code === 'keychain_timeout'
      );
    });

    it('maps ETIMEDOUT code to CookieImportError with code=keychain_timeout', async () => {
      const etimedoutErr = Object.assign(new Error('spawnSync security ETIMEDOUT'), {
        signal: null,
        stderr: '',
        code: 'ETIMEDOUT',
      });
      execFileSync.mockImplementation(() => { throw etimedoutErr; });

      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const { importCookies, CookieImportError } = await loadModule();

      await expect(importCookies('chrome', [])).rejects.toSatisfy((err) =>
        err instanceof CookieImportError && err.code === 'keychain_timeout'
      );
    });

    it('keychain_timeout error carries action=retry', async () => {
      const sigtermErr = Object.assign(new Error('killed'), {
        signal: 'SIGTERM',
        stderr: '',
        code: undefined,
      });
      execFileSync.mockImplementation(() => { throw sigtermErr; });

      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const { importCookies, CookieImportError } = await loadModule();

      await expect(importCookies('chrome', [])).rejects.toSatisfy((err) =>
        err instanceof CookieImportError &&
        err.code === 'keychain_timeout' &&
        err.action === 'retry'
      );
    });

    it('non-timeout errors are NOT mapped to keychain_timeout', async () => {
      const deniedErr = Object.assign(new Error('keychain denied'), {
        signal: null,
        stderr: 'user canceled',
        code: undefined,
      });
      execFileSync.mockImplementation(() => { throw deniedErr; });

      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const { importCookies, CookieImportError } = await loadModule();

      await expect(importCookies('chrome', [])).rejects.toSatisfy((err) =>
        err instanceof CookieImportError && err.code !== 'keychain_timeout'
      );
    });
  });

  // ── Fix 2: assertMacOS() platform guard ───────────────────────────────────

  describe('assertMacOS() — unsupported_platform', () => {
    it('throws CookieImportError(unsupported_platform) on linux', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

      const { importCookies, CookieImportError } = await loadModule();

      await expect(importCookies('chrome', [])).rejects.toSatisfy((err) =>
        err instanceof CookieImportError && err.code === 'unsupported_platform'
      );
    });

    it('throws CookieImportError(unsupported_platform) on win32', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');

      const { importCookies, CookieImportError } = await loadModule();

      await expect(importCookies('chrome', [])).rejects.toSatisfy((err) =>
        err instanceof CookieImportError && err.code === 'unsupported_platform'
      );
    });

    it('does NOT throw on darwin', async () => {
      // execFileSync returns a valid password; DB mock returns empty rows
      execFileSync.mockReturnValue('dGVzdHBhc3N3b3Jk\n'); // base64 "testpassword"

      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const { importCookies } = await loadModule();

      // Should resolve without unsupported_platform error
      const result = await importCookies('chrome', []);
      expect(result).toMatchObject({ count: 0, failed: 0 });
    });

    it('findInstalledBrowsers throws unsupported_platform on linux', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

      const { findInstalledBrowsers, CookieImportError } = await loadModule();

      expect(() => findInstalledBrowsers()).toThrow(
        expect.objectContaining({ code: 'unsupported_platform' })
      );
    });

    it('listDomains throws unsupported_platform on linux', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

      const { listDomains, CookieImportError } = await loadModule();

      expect(() => listDomains('chrome')).toThrow(
        expect.objectContaining({ code: 'unsupported_platform' })
      );
    });
  });

  // ── Fix 4: domain filter expansion ────────────────────────────────────────

  describe('importCookies — domain expansion (bare + dot variant)', () => {
    beforeEach(() => {
      // Happy-path keychain + darwin
      execFileSync.mockReturnValue('dGVzdA==\n');
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    });

    it('expands bare domain to include leading-dot variant in SQL params', async () => {
      // Capture the params passed to stmt.all()
      let capturedParams;
      const mockStmt = { all: vi.fn((...args) => { capturedParams = args; return []; }) };
      const Database = (await import('better-sqlite3')).default;
      Database.mockReturnValue({
        prepare: vi.fn(() => mockStmt),
        close: vi.fn(),
      });

      const { importCookies } = await loadModule();
      await importCookies('chrome', ['github.com']);

      // params = [...expanded, now]; expanded = ['github.com', '.github.com']
      expect(capturedParams[0]).toBe('github.com');
      expect(capturedParams[1]).toBe('.github.com');
    });

    it('does not double-dot a domain that already starts with a dot', async () => {
      let capturedParams;
      const mockStmt = { all: vi.fn((...args) => { capturedParams = args; return []; }) };
      const Database = (await import('better-sqlite3')).default;
      Database.mockReturnValue({
        prepare: vi.fn(() => mockStmt),
        close: vi.fn(),
      });

      const { importCookies } = await loadModule();
      await importCookies('chrome', ['.github.com']);

      // '.github.com' already starts with dot → expansion keeps it as-is
      // flatMap(d => [d, d.startsWith('.') ? d : `.${d}`])
      // → ['.github.com', '.github.com']  (deduped by Set? no — check source)
      // Source does NOT dedup; both entries are '.github.com'
      expect(capturedParams[0]).toBe('.github.com');
      expect(capturedParams[1]).toBe('.github.com');
    });

    it('expands multiple domains each to both variants', async () => {
      let capturedParams;
      const mockStmt = { all: vi.fn((...args) => { capturedParams = args; return []; }) };
      const Database = (await import('better-sqlite3')).default;
      Database.mockReturnValue({
        prepare: vi.fn(() => mockStmt),
        close: vi.fn(),
      });

      const { importCookies } = await loadModule();
      await importCookies('chrome', ['a.com', 'b.com']);

      // expanded = ['a.com', '.a.com', 'b.com', '.b.com']
      expect(capturedParams[0]).toBe('a.com');
      expect(capturedParams[1]).toBe('.a.com');
      expect(capturedParams[2]).toBe('b.com');
      expect(capturedParams[3]).toBe('.b.com');
    });

    it('uses single SQL statement (no domain filter) when domains array is empty', async () => {
      let capturedParams;
      const mockStmt = { all: vi.fn((...args) => { capturedParams = args; return []; }) };
      const Database = (await import('better-sqlite3')).default;
      Database.mockReturnValue({
        prepare: vi.fn(() => mockStmt),
        close: vi.fn(),
      });

      const { importCookies } = await loadModule();
      await importCookies('chrome', []);

      // Empty domains → single param = [now]; no domain expansion
      expect(capturedParams).toHaveLength(1);
    });
  });
});
