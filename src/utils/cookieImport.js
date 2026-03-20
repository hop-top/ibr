/**
 * Chromium browser cookie import — read and decrypt cookies from real browsers.
 *
 * Supports macOS Chromium-based browsers: Comet, Chrome, Arc, Brave, Edge.
 * Pure logic module — no Playwright dependency, no HTTP concerns.
 *
 * Decryption pipeline (Chromium macOS "v10" format):
 *
 *   1. Keychain: `security find-generic-password -s "<svc>" -w`
 *      → base64 password string
 *
 *   2. Key derivation:
 *      PBKDF2(password, salt="saltysalt", iter=1003, len=16, sha1)
 *      → 16-byte AES key
 *
 *   3. For each cookie with encrypted_value starting with "v10":
 *      - Ciphertext = encrypted_value[3:]
 *      - IV = 16 bytes of 0x20 (space character)
 *      - Plaintext = AES-128-CBC-decrypt(key, iv, ciphertext)
 *      - Remove PKCS7 padding
 *      - Skip first 32 bytes (HMAC-SHA256 authentication tag)
 *      - Remaining bytes = cookie value (UTF-8)
 *
 *   4. If encrypted_value is empty but `value` field is set,
 *      use value directly (unencrypted cookie)
 *
 *   5. Chromium epoch: microseconds since 1601-01-01
 *      Unix seconds = (epoch - 11644473600000000) / 1000000
 *
 *   6. sameSite: 0→"None", 1→"Lax", 2→"Strict", else→"Lax"
 *
 * macOS only — no Windows/Linux support.
 */

import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

// ─── Browser Registry ────────────────────────────────────────────
// Hardcoded — NEVER interpolate user input into shell commands.

export const BROWSER_REGISTRY = [
  {
    name: 'Comet',
    dataDir: 'Comet/',
    keychainService: 'Comet Safe Storage',
    aliases: ['comet', 'perplexity'],
  },
  {
    name: 'Chrome',
    dataDir: 'Google/Chrome/',
    keychainService: 'Chrome Safe Storage',
    aliases: ['chrome', 'google-chrome'],
  },
  {
    name: 'Arc',
    dataDir: 'Arc/User Data/',
    keychainService: 'Arc Safe Storage',
    aliases: ['arc'],
  },
  {
    name: 'Brave',
    dataDir: 'BraveSoftware/Brave-Browser/',
    keychainService: 'Brave Safe Storage',
    aliases: ['brave'],
  },
  {
    name: 'Edge',
    dataDir: 'Microsoft Edge/',
    keychainService: 'Microsoft Edge Safe Storage',
    aliases: ['edge'],
  },
];

// ─── Key Cache ───────────────────────────────────────────────────
// Derive once per browser per process.

const keyCache = new Map();

// ─── Error ───────────────────────────────────────────────────────

export class CookieImportError extends Error {
  constructor(message, code, action) {
    super(message);
    this.name = 'CookieImportError';
    this.code = code;
    this.action = action; // 'retry' | undefined
  }
}

// ─── Platform Guard ───────────────────────────────────────────────

function assertMacOS() {
  if (process.platform !== 'darwin') {
    throw new CookieImportError(
      `Cookie import is only supported on macOS (current platform: ${process.platform}).`,
      'unsupported_platform',
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Find which browsers are installed (have a cookie DB on disk).
 * @returns {Array<{name:string, dataDir:string, keychainService:string, aliases:string[]}>}
 */
export function findInstalledBrowsers() {
  assertMacOS();
  const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
  return BROWSER_REGISTRY.filter(b => {
    const dbPath = path.join(appSupport, b.dataDir, 'Default', 'Cookies');
    try { return fs.existsSync(dbPath); } catch { return false; }
  });
}

/**
 * List unique cookie domains + counts from a browser's DB. No decryption.
 * @param {string} browserName
 * @param {string} [profile]
 * @returns {{ domains: Array<{domain:string, count:number}>, browser: string }}
 */
export function listDomains(browserName, profile = 'Default') {
  assertMacOS();
  const browser = resolveBrowser(browserName);
  const dbPath = getCookieDbPath(browser, profile);
  const db = openDb(dbPath, browser.name);
  try {
    const now = chromiumNow();
    const rows = db.prepare(
      `SELECT host_key AS domain, COUNT(*) AS count
       FROM cookies
       WHERE has_expires = 0 OR expires_utc > ?
       GROUP BY host_key
       ORDER BY count DESC`
    ).all(now);
    return { domains: rows, browser: browser.name };
  } finally {
    db.close();
  }
}

/**
 * Decrypt and return Playwright-compatible cookies for the given domains.
 * Pass empty domains array to import ALL non-expired cookies.
 *
 * @param {string} browserName
 * @param {string[]} domains  — empty = all
 * @param {string} [profile]
 * @returns {Promise<{cookies: Array, count: number, failed: number, domainCounts: Object}>}
 */
export async function importCookies(browserName, domains, profile = 'Default') {
  assertMacOS();
  const browser = resolveBrowser(browserName);
  const derivedKey = getDerivedKey(browser);
  const dbPath = getCookieDbPath(browser, profile);
  const db = openDb(dbPath, browser.name);

  try {
    const now = chromiumNow();

    let stmt;
    let params;
    if (domains.length === 0) {
      // All non-expired cookies
      stmt = db.prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                is_secure, is_httponly, has_expires, samesite
         FROM cookies
         WHERE has_expires = 0 OR expires_utc > ?
         ORDER BY host_key, name`
      );
      params = [now];
    } else {
      // Include both bare domain and leading-dot variant (Chromium stores domain
      // cookies as ".github.com" but callers typically pass "github.com").
      const expanded = domains.flatMap(d => [d, d.startsWith('.') ? d : `.${d}`]);
      const placeholders = expanded.map(() => '?').join(',');
      stmt = db.prepare(
        `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                is_secure, is_httponly, has_expires, samesite
         FROM cookies
         WHERE host_key IN (${placeholders})
           AND (has_expires = 0 OR expires_utc > ?)
         ORDER BY host_key, name`
      );
      params = [...expanded, now];
    }

    const rows = stmt.all(...params);

    const cookies = [];
    let failed = 0;
    const domainCounts = {};

    for (const row of rows) {
      try {
        const value = decryptCookieValue(row, derivedKey);
        const cookie = toPlaywrightCookie(row, value);
        cookies.push(cookie);
        domainCounts[row.host_key] = (domainCounts[row.host_key] || 0) + 1;
      } catch {
        failed++;
      }
    }

    return { cookies, count: cookies.length, failed, domainCounts };
  } finally {
    db.close();
  }
}

// ─── Internal: Browser Resolution ───────────────────────────────

function resolveBrowser(nameOrAlias) {
  const needle = nameOrAlias.toLowerCase().trim();
  const found = BROWSER_REGISTRY.find(b =>
    b.aliases.includes(needle) || b.name.toLowerCase() === needle
  );
  if (!found) {
    const supported = BROWSER_REGISTRY.flatMap(b => b.aliases).join(', ');
    throw new CookieImportError(
      `Unknown browser '${nameOrAlias}'. Supported: ${supported}`,
      'unknown_browser',
    );
  }
  return found;
}

function validateProfile(profile) {
  if (/[/\\]|\.\./.test(profile) || /[\x00-\x1f]/.test(profile)) {
    throw new CookieImportError(
      `Invalid profile name: '${profile}'`,
      'bad_request',
    );
  }
}

function getCookieDbPath(browser, profile) {
  validateProfile(profile);
  const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
  const dbPath = path.join(appSupport, browser.dataDir, profile, 'Cookies');
  if (!fs.existsSync(dbPath)) {
    throw new CookieImportError(
      `${browser.name} is not installed (no cookie database at ${dbPath})`,
      'not_installed',
    );
  }
  return dbPath;
}

// ─── Internal: SQLite Access ─────────────────────────────────────

function openDb(dbPath, browserName) {
  try {
    return new Database(dbPath, { readonly: true });
  } catch (err) {
    if (err.message?.includes('SQLITE_BUSY') || err.message?.includes('database is locked')) {
      return openDbFromCopy(dbPath, browserName);
    }
    if (err.message?.includes('SQLITE_CORRUPT') || err.message?.includes('malformed')) {
      throw new CookieImportError(
        `Cookie database for ${browserName} is corrupt`,
        'db_corrupt',
      );
    }
    throw err;
  }
}

function openDbFromCopy(dbPath, browserName) {
  const tmpPath = `/tmp/idx-cookies-${browserName.toLowerCase()}-${crypto.randomUUID()}.db`;
  try {
    fs.copyFileSync(dbPath, tmpPath);
    // Copy WAL + SHM for consistent reads
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    if (fs.existsSync(walPath)) fs.copyFileSync(walPath, tmpPath + '-wal');
    if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, tmpPath + '-shm');

    const db = new Database(tmpPath, { readonly: true });
    // Schedule cleanup when DB is closed
    const origClose = db.close.bind(db);
    db.close = () => {
      origClose();
      try { fs.unlinkSync(tmpPath); } catch {}
      try { fs.unlinkSync(tmpPath + '-wal'); } catch {}
      try { fs.unlinkSync(tmpPath + '-shm'); } catch {}
    };
    return db;
  } catch {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new CookieImportError(
      `Cookie database is locked (${browserName} may be running). Try closing ${browserName} first.`,
      'db_locked',
      'retry',
    );
  }
}

// ─── Internal: Keychain Access ───────────────────────────────────

function getDerivedKey(browser) {
  const cached = keyCache.get(browser.keychainService);
  if (cached) return cached;

  const password = getKeychainPassword(browser.keychainService);
  const derived = crypto.pbkdf2Sync(
    Buffer.from(password, 'utf-8'),
    'saltysalt',
    1003,
    16,
    'sha1',
  );
  keyCache.set(browser.keychainService, derived);
  return derived;
}

function getKeychainPassword(service) {
  // execFileSync — safe: no shell, args are a static list, service is from BROWSER_REGISTRY.
  // Use execFileSync's built-in `timeout` so the OS-level kill fires even while the
  // event loop is blocked (a JS setTimeout cannot fire while execFileSync blocks).
  let stdout;
  try {
    stdout = execFileSync('security', [
      'find-generic-password', '-s', service, '-w',
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
  } catch (err) {
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      throw new CookieImportError(
        `macOS Keychain timeout. Look for a dialog asking to allow access to "${service}".`,
        'keychain_timeout',
        'retry',
      );
    }
    const errText = (err.stderr || '').toLowerCase();
    if (errText.includes('user canceled') || errText.includes('denied') || errText.includes('interaction not allowed')) {
      throw new CookieImportError(
        `Keychain access denied. Click "Allow" in the macOS dialog for "${service}".`,
        'keychain_denied',
        'retry',
      );
    }
    if (errText.includes('could not be found') || errText.includes('not found')) {
      throw new CookieImportError(
        `No Keychain entry for "${service}". Is this a Chromium-based browser?`,
        'keychain_not_found',
      );
    }
    throw new CookieImportError(
      `Could not read Keychain: ${(err.stderr || err.message || '').trim()}`,
      'keychain_error',
      'retry',
    );
  }
  return stdout.trim();
}

// ─── Internal: Cookie Decryption ────────────────────────────────

function decryptCookieValue(row, key) {
  // Prefer unencrypted value if present
  if (row.value && row.value.length > 0) return row.value;

  const ev = Buffer.from(row.encrypted_value);
  if (ev.length === 0) return '';

  const prefix = ev.slice(0, 3).toString('utf-8');
  if (prefix !== 'v10') {
    throw new Error(`Unknown encryption prefix: ${prefix}`);
  }

  const ciphertext = ev.slice(3);
  const iv = Buffer.alloc(16, 0x20); // 16 × space character
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // First 32 bytes = HMAC-SHA256 auth tag; actual value follows
  if (plaintext.length <= 32) return '';
  return plaintext.slice(32).toString('utf-8');
}

function toPlaywrightCookie(row, value) {
  return {
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path || '/',
    expires: chromiumEpochToUnix(row.expires_utc, row.has_expires),
    secure: row.is_secure === 1,
    httpOnly: row.is_httponly === 1,
    sameSite: mapSameSite(row.samesite),
  };
}

// ─── Internal: Chromium Epoch Conversion ────────────────────────

const CHROMIUM_EPOCH_OFFSET = 11644473600000000n;

function chromiumNow() {
  return BigInt(Date.now()) * 1000n + CHROMIUM_EPOCH_OFFSET;
}

function chromiumEpochToUnix(epoch, hasExpires) {
  if (hasExpires === 0 || epoch === 0 || epoch === 0n) return -1; // session cookie
  const epochBig = BigInt(epoch);
  const unixMicro = epochBig - CHROMIUM_EPOCH_OFFSET;
  return Number(unixMicro / 1000000n);
}

function mapSameSite(value) {
  switch (value) {
    case 0: return 'None';
    case 1: return 'Lax';
    case 2: return 'Strict';
    default: return 'Lax';
  }
}
