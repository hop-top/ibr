/**
 * Chromium browser cookie import — read and decrypt cookies from real browsers.
 *
 * Supports Chromium-based browsers on:
 *   - macOS: Comet, Chrome, Arc, Brave, Edge
 *   - Linux: Chrome, Brave, Edge, Chromium
 *   - Windows: Chrome, Brave, Edge, Chromium
 *
 * Windows support covers:
 *   - legacy DPAPI-encrypted cookie blobs
 *   - `v10` AES-256-GCM cookies using the Local State master key
 *
 * Windows `v20` app-bound encrypted cookies are detected but not yet supported.
 *
 * Pure logic module — no Playwright dependency, no HTTP concerns.
 *
 * Decryption pipeline:
 *
 *   1. Safe Storage password:
 *      - macOS: `security find-generic-password -s "<svc>" -w`
 *      - Linux: fixed password `peanuts`
 *      - Windows: Local State `os_crypt.encrypted_key` → DPAPI unprotect
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
    dataDirs: { darwin: 'Comet/' },
    keychainService: 'Comet Safe Storage',
    aliases: ['comet', 'perplexity'],
  },
  {
    name: 'Chrome',
    dataDirs: {
      darwin: 'Google/Chrome/',
      linux: 'google-chrome/',
      win32: 'Google/Chrome/User Data/',
    },
    keychainService: 'Chrome Safe Storage',
    aliases: ['chrome', 'google-chrome'],
  },
  {
    name: 'Arc',
    dataDirs: { darwin: 'Arc/User Data/' },
    keychainService: 'Arc Safe Storage',
    aliases: ['arc'],
  },
  {
    name: 'Brave',
    dataDirs: {
      darwin: 'BraveSoftware/Brave-Browser/',
      linux: 'BraveSoftware/Brave-Browser/',
      win32: 'BraveSoftware/Brave-Browser/User Data/',
    },
    keychainService: 'Brave Safe Storage',
    aliases: ['brave'],
  },
  {
    name: 'Edge',
    dataDirs: {
      darwin: 'Microsoft Edge/',
      linux: 'microsoft-edge/',
      win32: 'Microsoft/Edge/User Data/',
    },
    keychainService: 'Microsoft Edge Safe Storage',
    aliases: ['edge'],
  },
  {
    name: 'Chromium',
    dataDirs: {
      linux: 'chromium/',
      win32: 'Chromium/User Data/',
    },
    keychainService: 'Chromium Safe Storage',
    aliases: ['chromium'],
  },
];

const COOKIE_BROWSER_HELP_TEXT =
  'chrome, brave, edge, arc (macOS), comet (macOS), chromium (Linux/Windows)';
const LINUX_SAFE_STORAGE_PASSWORD = 'peanuts';
const WINDOWS_DPAPI_KEY_PREFIX = 'DPAPI';
const WINDOWS_COOKIE_KEY_LENGTH = 256 / 8;
const WINDOWS_GCM_NONCE_LENGTH = 96 / 8;
const WINDOWS_GCM_TAG_LENGTH = 16;

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

function assertSupportedPlatform() {
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
    throw new CookieImportError(
      `Cookie import is supported on macOS, Linux, and Windows only (current platform: ${process.platform}).`,
      'unsupported_platform',
    );
  }
}

function getConfigBase() {
  assertSupportedPlatform();
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function getSupportedBrowsers() {
  assertSupportedPlatform();
  return BROWSER_REGISTRY.filter(browser => Boolean(browser.dataDirs[process.platform]));
}

function getBrowserDataDir(browser) {
  const dataDir = browser.dataDirs[process.platform];
  if (!dataDir) {
    throw new CookieImportError(
      `${browser.name} cookie import is not supported on ${process.platform}.`,
      'unsupported_browser',
    );
  }
  return dataDir;
}

export function getSupportedCookieBrowsersHelpText() {
  return COOKIE_BROWSER_HELP_TEXT;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Find which browsers are installed (have a cookie DB on disk for this platform).
 * @returns {Array<{name:string, dataDirs:Object, keychainService:string, aliases:string[]}>}
 */
export function findInstalledBrowsers() {
  return getSupportedBrowsers().filter(browser => {
    try {
      return getCookieDbCandidates(browser, 'Default').some(candidate => fs.existsSync(candidate));
    } catch {
      return false;
    }
  });
}

/**
 * List unique cookie domains + counts from a browser's DB. No decryption.
 * @param {string} browserName
 * @param {string} [profile]
 * @returns {{ domains: Array<{domain:string, count:number}>, browser: string }}
 */
export function listDomains(browserName, profile = 'Default') {
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
  const browser = resolveBrowser(browserName);
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
    const derivedKey = shouldLoadBrowserKey(rows) ? getDerivedKey(browser) : null;

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
  const browsers = getSupportedBrowsers();
  const needle = nameOrAlias.toLowerCase().trim();
  const found = browsers.find(b =>
    b.aliases.includes(needle) || b.name.toLowerCase() === needle
  );
  if (!found) {
    const supported = browsers.flatMap(b => b.aliases).join(', ');
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
  const dbPath = getCookieDbCandidates(browser, profile).find(candidate => fs.existsSync(candidate));
  if (!dbPath) {
    throw new CookieImportError(
      `${browser.name} is not installed (no cookie database found for profile ${profile})`,
      'not_installed',
    );
  }
  return dbPath;
}

function getCookieDbCandidates(browser, profile) {
  const basePath = path.join(getConfigBase(), getBrowserDataDir(browser), profile);
  if (process.platform === 'win32') {
    return [
      path.join(basePath, 'Network', 'Cookies'),
      path.join(basePath, 'Cookies'),
    ];
  }
  return [path.join(basePath, 'Cookies')];
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
  const tmpPath = path.join(
    os.tmpdir(),
    `ibr-cookies-${browserName.toLowerCase()}-${crypto.randomUUID()}.db`,
  );
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
  const cacheKey = `${process.platform}:${browser.keychainService}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  let derived;
  if (process.platform === 'linux') {
    derived = crypto.pbkdf2Sync(
      Buffer.from(LINUX_SAFE_STORAGE_PASSWORD, 'utf-8'),
      'saltysalt',
      1003,
      16,
      'sha1',
    );
  } else if (process.platform === 'darwin') {
    const password = getKeychainPassword(browser.keychainService);
    derived = crypto.pbkdf2Sync(
      Buffer.from(password, 'utf-8'),
      'saltysalt',
      1003,
      16,
      'sha1',
    );
  } else {
    derived = getWindowsMasterKey(browser);
  }

  keyCache.set(cacheKey, derived);
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

function getWindowsMasterKey(browser) {
  const localStatePath = path.join(getConfigBase(), getBrowserDataDir(browser), 'Local State');
  let localStateRaw;
  try {
    localStateRaw = fs.readFileSync(localStatePath, 'utf8');
  } catch (err) {
    throw new CookieImportError(
      `Could not read Windows Local State for ${browser.name}: ${err.message}`,
      'windows_key_not_found',
      'retry',
    );
  }

  let localState;
  try {
    localState = JSON.parse(localStateRaw);
  } catch (err) {
    throw new CookieImportError(
      `Windows Local State is not valid JSON for ${browser.name}.`,
      'windows_key_error',
    );
  }

  const encodedKey = localState.os_crypt?.encrypted_key;
  if (!encodedKey) {
    throw new CookieImportError(
      `No Windows Local State encrypted_key found for ${browser.name}.`,
      'windows_key_not_found',
    );
  }

  const encryptedKeyWithHeader = Buffer.from(encodedKey, 'base64');
  if (!encryptedKeyWithHeader.subarray(0, WINDOWS_DPAPI_KEY_PREFIX.length)
    .equals(Buffer.from(WINDOWS_DPAPI_KEY_PREFIX, 'utf8'))) {
    throw new CookieImportError(
      `Windows Local State encrypted_key format is invalid for ${browser.name}.`,
      'windows_key_error',
    );
  }

  const encryptedKey = encryptedKeyWithHeader.subarray(WINDOWS_DPAPI_KEY_PREFIX.length);
  const decryptedKey = decryptWindowsDpapi(encryptedKey);
  if (decryptedKey.length !== WINDOWS_COOKIE_KEY_LENGTH) {
    throw new CookieImportError(
      `Windows cookie key has unexpected length for ${browser.name}.`,
      'windows_key_error',
    );
  }

  return decryptedKey;
}

function decryptWindowsDpapi(buffer) {
  const script = [
    '$inputBytes = [Convert]::FromBase64String($env:IBR_DPAPI_INPUT)',
    '$outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(',
    '  $inputBytes,',
    '  $null,',
    '  [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
    ')',
    '[Console]::Out.Write([Convert]::ToBase64String($outputBytes))',
  ].join('\n');

  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  const env = { ...process.env, IBR_DPAPI_INPUT: buffer.toString('base64') };
  let lastErr;

  for (const binary of ['powershell.exe', 'pwsh.exe']) {
    try {
      const stdout = execFileSync(
        binary,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10_000,
          env,
        },
      );
      return Buffer.from(stdout.trim(), 'base64');
    } catch (err) {
      lastErr = err;
      if (err.code === 'ENOENT') continue;
      if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
        throw new CookieImportError(
          'Windows DPAPI helper timed out while decrypting Chromium data.',
          'windows_dpapi_timeout',
          'retry',
        );
      }
      throw new CookieImportError(
        `Windows DPAPI decryption failed: ${(err.stderr || err.message || '').trim()}`,
        'windows_dpapi_error',
        'retry',
      );
    }
  }

  throw new CookieImportError(
    `Windows DPAPI helper is unavailable: ${lastErr?.message || 'PowerShell not found'}`,
    'windows_dpapi_unavailable',
    'retry',
  );
}

// ─── Internal: Cookie Decryption ────────────────────────────────

function decryptCookieValue(row, key) {
  // Prefer unencrypted value if present
  if (row.value && row.value.length > 0) return row.value;

  const ev = Buffer.from(row.encrypted_value);
  if (ev.length === 0) return '';

  if (process.platform === 'win32') {
    return decryptWindowsCookieValue(ev, key);
  }

  const prefix = ev.slice(0, 3).toString('utf-8');
  if (prefix !== 'v10') {
    throw new Error(
      `Unknown cookie encryption prefix: "${prefix}" (expected "v10"). ` +
      `This cookie may have been encrypted with an unsupported Chromium version. ` +
      `Only macOS/Linux Chromium "v10" AES-128-CBC cookies are supported.`
    );
  }

  const ciphertext = ev.slice(3);
  const iv = Buffer.alloc(16, 0x20); // 16 × space character
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // First 32 bytes = HMAC-SHA256 auth tag; actual value follows
  if (plaintext.length <= 32) return '';
  return plaintext.slice(32).toString('utf-8');
}

function decryptWindowsCookieValue(encryptedValue, key) {
  const prefix = encryptedValue.slice(0, 3).toString('utf8');
  if (prefix === 'v10') {
    const resolvedKey = resolveKey(key);
    const nonce = encryptedValue.subarray(3, 3 + WINDOWS_GCM_NONCE_LENGTH);
    const ciphertext = encryptedValue.subarray(
      3 + WINDOWS_GCM_NONCE_LENGTH,
      encryptedValue.length - WINDOWS_GCM_TAG_LENGTH,
    );
    const tag = encryptedValue.subarray(encryptedValue.length - WINDOWS_GCM_TAG_LENGTH);

    const decipher = crypto.createDecipheriv('aes-256-gcm', resolvedKey, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  const prefix4 = encryptedValue.slice(0, 3).toString('utf8') === 'v20'
    ? 'v20'
    : encryptedValue.slice(0, 4).toString('utf8');
  if (prefix4 === 'v20') {
    throw new Error(
      'Windows app-bound Chromium cookie encryption (v20) is not yet supported.',
    );
  }

  return decryptWindowsDpapi(encryptedValue).toString('utf8');
}

function resolveKey(key) {
  return typeof key === 'function' ? key() : key;
}

function shouldLoadBrowserKey(rows) {
  return rows.some((row) => {
    if (row.value && row.value.length > 0) return false;
    const encryptedValue = Buffer.from(row.encrypted_value || []);
    if (encryptedValue.length === 0) return false;
    if (process.platform === 'win32') {
      return encryptedValue.slice(0, 3).toString('utf8') === 'v10';
    }
    return true;
  });
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

/* test exports */
export {
  decryptCookieValue,
  toPlaywrightCookie,
  chromiumEpochToUnix,
  mapSameSite,
  decryptWindowsDpapi,
};
