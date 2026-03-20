/**
 * Regression tests for Copilot review fixes in cookieImport.js
 *
 * Fixes covered:
 *   1. Keychain timeout — execFileSync SIGTERM/ETIMEDOUT → CookieImportError('keychain_timeout')
 *   2. assertMacOS() — non-darwin platform → CookieImportError('unsupported_platform')
 *   3. Domain filter expansion — bare domain auto-expands to include leading-dot variant
 *   4. Pure function unit tests: decryptCookieValue, toPlaywrightCookie,
 *      chromiumEpochToUnix, mapSameSite
 */

import crypto from 'crypto';
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

  // ── keychain_not_found and keychain_error branches ────────────────────────

  describe('getKeychainPassword — keychain_not_found + keychain_error', () => {
    it('maps "could not be found" stderr to keychain_not_found', async () => {
      const err = Object.assign(new Error('not found'), {
        signal: null,
        stderr: 'The specified item could not be found',
        code: undefined,
      });
      execFileSync.mockImplementation(() => { throw err; });
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const { importCookies, CookieImportError } = await loadModule();
      await expect(importCookies('chrome', [])).rejects.toSatisfy(
        e => e instanceof CookieImportError && e.code === 'keychain_not_found'
      );
    });

    it('maps "not found" stderr to keychain_not_found', async () => {
      const err = Object.assign(new Error('not found'), {
        signal: null,
        stderr: 'SecKeychainSearchCopyNext: not found',
        code: undefined,
      });
      execFileSync.mockImplementation(() => { throw err; });
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const { importCookies, CookieImportError } = await loadModule();
      await expect(importCookies('chrome', [])).rejects.toSatisfy(
        e => e instanceof CookieImportError && e.code === 'keychain_not_found'
      );
    });

    it('maps unknown keychain error to keychain_error', async () => {
      const err = Object.assign(new Error('something unexpected'), {
        signal: null,
        stderr: 'some other keychain failure',
        code: undefined,
      });
      execFileSync.mockImplementation(() => { throw err; });
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const { importCookies, CookieImportError } = await loadModule();
      await expect(importCookies('chrome', [])).rejects.toSatisfy(
        e => e instanceof CookieImportError && e.code === 'keychain_error'
      );
    });
  });

  // ── openDbFromCopy — db_locked path ────────────────────────────────────────

  describe('openDb — SQLITE_BUSY triggers openDbFromCopy → db_locked', () => {
    it('throws db_locked when DB is busy and copy also fails', async () => {
      execFileSync.mockReturnValue('dGVzdA==\n');
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      // First Database() call → SQLITE_BUSY; copy path → also throws
      const Database = (await import('better-sqlite3')).default;
      const fs = await import('fs');
      // copyFileSync throws so openDbFromCopy catch fires
      fs.copyFileSync.mockImplementation(() => { throw new Error('copy failed'); });
      Database.mockImplementation(() => {
        const e = new Error('SQLITE_BUSY: database is locked');
        e.message = 'SQLITE_BUSY: database is locked';
        throw e;
      });

      const { importCookies, CookieImportError } = await loadModule();
      await expect(importCookies('chrome', [])).rejects.toSatisfy(
        e => e instanceof CookieImportError && e.code === 'db_locked'
      );
    });

    it('opens DB from copy successfully when original is busy', async () => {
      execFileSync.mockReturnValue('dGVzdA==\n');
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

      const fs = await import('fs');
      fs.copyFileSync.mockImplementation(() => {});
      // existsSync: first call (getCookieDbPath) → true; wal/shm → false
      fs.existsSync
        .mockReturnValueOnce(true)   // getCookieDbPath check
        .mockReturnValue(false);     // wal / shm not present

      const mockStmt = { all: vi.fn(() => []) };
      const mockDb = { prepare: vi.fn(() => mockStmt), close: vi.fn() };

      const Database = (await import('better-sqlite3')).default;
      let callCount = 0;
      Database.mockImplementation((p) => {
        callCount++;
        if (callCount === 1) {
          const e = new Error('SQLITE_BUSY: database is locked');
          throw e;
        }
        return mockDb;
      });

      const { importCookies } = await loadModule();
      const result = await importCookies('chrome', []);
      expect(result).toMatchObject({ count: 0 });
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

// ─── Pure-function unit tests (no mocks needed) ──────────────────────────────

import {
  decryptCookieValue,
  toPlaywrightCookie,
  chromiumEpochToUnix,
  mapSameSite,
} from '../../../src/utils/cookieImport.js';

// Pre-computed v10 fixture:
//   key = Buffer.alloc(16, 0xAB), iv = Buffer.alloc(16, 0x20)
//   payload = [32× 0x00] + "test-value"
const TEST_KEY = Buffer.alloc(16, 0xAB);
const ENCRYPTED_V10_HEX =
  '763130b4f90a7f44e8388f66ceae1e62e06ec05b522e3a9d674a6bf97645ea57c3d4a2a70bcde99482355074dfd3312ddf1169';

describe('decryptCookieValue — pure crypto', () => {
  it('returns row.value directly when non-empty (unencrypted path)', () => {
    const row = { value: 'plain', encrypted_value: Buffer.alloc(0) };
    expect(decryptCookieValue(row, TEST_KEY)).toBe('plain');
  });

  it('returns empty string when encrypted_value is empty Buffer', () => {
    const row = { value: '', encrypted_value: Buffer.alloc(0) };
    expect(decryptCookieValue(row, TEST_KEY)).toBe('');
  });

  it('throws on unknown encryption prefix', () => {
    const ev = Buffer.concat([Buffer.from('xyz'), Buffer.alloc(16, 0)]);
    const row = { value: '', encrypted_value: ev };
    expect(() => decryptCookieValue(row, TEST_KEY)).toThrow('Unknown cookie encryption prefix: "xyz"');
  });

  it('decrypts a valid v10-encrypted value correctly', () => {
    const ev = Buffer.from(ENCRYPTED_V10_HEX, 'hex');
    const row = { value: '', encrypted_value: ev };
    expect(decryptCookieValue(row, TEST_KEY)).toBe('test-value');
  });

  it('returns empty string when decrypted plaintext is exactly 32 bytes (no payload)', () => {
    // Encrypt a payload of exactly 32 bytes (all zeros) — after stripping prefix, value = ''
    const key = TEST_KEY;
    const iv = Buffer.alloc(16, 0x20);
    const payload = Buffer.alloc(32, 0); // 32 bytes HMAC tag, nothing after
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
    const ev = Buffer.concat([Buffer.from('v10'), encrypted]);
    const row = { value: '', encrypted_value: ev };
    expect(decryptCookieValue(row, TEST_KEY)).toBe('');
  });

  it('returns bytes after first 32 when decrypted plaintext >32 bytes', () => {
    // Already covered by the fixture test above; verify the slice explicitly
    const ev = Buffer.from(ENCRYPTED_V10_HEX, 'hex');
    const row = { value: '', encrypted_value: ev };
    const result = decryptCookieValue(row, TEST_KEY);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe('test-value');
  });
});

describe('toPlaywrightCookie — field mapping', () => {
  const baseRow = {
    name: 'session',
    host_key: '.example.com',
    path: '/app',
    expires_utc: 13000000000000000n,
    is_secure: 1,
    is_httponly: 1,
    has_expires: 1,
    samesite: 2,
  };

  it('maps all fields correctly', () => {
    const cookie = toPlaywrightCookie(baseRow, 'abc123');
    expect(cookie.name).toBe('session');
    expect(cookie.value).toBe('abc123');
    expect(cookie.domain).toBe('.example.com');
    expect(cookie.path).toBe('/app');
    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(typeof cookie.expires).toBe('number');
  });

  it('defaults path to "/" when row.path is null', () => {
    const row = { ...baseRow, path: null };
    expect(toPlaywrightCookie(row, 'v').path).toBe('/');
  });

  it('defaults path to "/" when row.path is undefined', () => {
    const row = { ...baseRow, path: undefined };
    expect(toPlaywrightCookie(row, 'v').path).toBe('/');
  });

  it('is_secure=0 → secure:false', () => {
    const row = { ...baseRow, is_secure: 0 };
    expect(toPlaywrightCookie(row, 'v').secure).toBe(false);
  });

  it('is_httponly=0 → httpOnly:false', () => {
    const row = { ...baseRow, is_httponly: 0 };
    expect(toPlaywrightCookie(row, 'v').httpOnly).toBe(false);
  });
});

describe('chromiumEpochToUnix — session + epoch conversion', () => {
  it('returns -1 when hasExpires=0 (session cookie)', () => {
    expect(chromiumEpochToUnix(13000000000000000n, 0)).toBe(-1);
  });

  it('returns -1 when epoch=0', () => {
    expect(chromiumEpochToUnix(0, 1)).toBe(-1);
  });

  it('returns -1 when epoch=0n (BigInt)', () => {
    expect(chromiumEpochToUnix(0n, 1)).toBe(-1);
  });

  it('converts a known Chromium epoch to correct Unix timestamp', () => {
    // 13_000_000_000_000_000 µs chromium epoch
    // unix = (13000000000000000 - 11644473600000000) / 1000000 = 1355526400
    const result = chromiumEpochToUnix(13000000000000000n, 1);
    expect(result).toBe(1355526400);
  });

  it('accepts numeric epoch (non-BigInt)', () => {
    // Same epoch value as number
    const result = chromiumEpochToUnix(13000000000000000, 1);
    expect(result).toBe(1355526400);
  });
});

describe('mapSameSite — value mapping', () => {
  it('0 → None', () => expect(mapSameSite(0)).toBe('None'));
  it('1 → Lax', () => expect(mapSameSite(1)).toBe('Lax'));
  it('2 → Strict', () => expect(mapSameSite(2)).toBe('Strict'));
  it('default (unknown) → Lax', () => expect(mapSameSite(99)).toBe('Lax'));
  it('-1 → Lax', () => expect(mapSameSite(-1)).toBe('Lax'));
});
