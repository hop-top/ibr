/**
 * importCookies domain filter — real SQLite fixture, no mocks.
 *
 * A domain filter must follow cookie domain-matching (RFC 6265 §5.1.3):
 * `nytimes.com` covers the host itself and every subdomain, whether Chromium
 * stored the host_key with or without a leading dot.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CHROMIUM_EPOCH_OFFSET = 11644473600n;
const FUTURE = ((BigInt(Math.floor(Date.now() / 1000)) + 86400n * 365n + CHROMIUM_EPOCH_OFFSET) * 1000000n).toString();
const PAST = ((BigInt(Math.floor(Date.now() / 1000)) - 86400n + CHROMIUM_EPOCH_OFFSET) * 1000000n).toString();

let configHome;

function writeCookieDb(rows) {
  const dir = path.join(configHome, 'BraveSoftware/Brave-Browser/Default');
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'Cookies'));
  db.exec(`CREATE TABLE cookies (
    host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT,
    expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER,
    has_expires INTEGER, samesite INTEGER)`);
  const insert = db.prepare(
    `INSERT INTO cookies VALUES (?, ?, 'v', x'', '/', ?, 1, 0, 1, 1)`,
  );
  for (const [host, name, expires = FUTURE] of rows) insert.run(host, name, expires);
  db.close();
}

async function importFor(domains) {
  vi.resetModules();
  const { importCookies } = await import('../../../src/utils/cookieImport.js?t=' + Date.now());
  const result = await importCookies('brave', domains);
  return result.cookies.map(c => c.domain).sort();
}

describe.skipIf(process.platform === 'win32')('importCookies — domain filter', () => {
  beforeEach(() => {
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ibr-cookie-domain-'));
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.stubEnv('XDG_CONFIG_HOME', configHome);
    writeCookieDb([
      ['nytimes.com', 'host-only'],
      ['.nytimes.com', 'domain'],
      ['www.nytimes.com', 'www-host'],
      ['.www.nytimes.com', 'www-domain'],
      ['.myaccount.nytimes.com', 'deep'],
      ['.nytimes.com', 'expired', PAST],
      ['notnytimes.com', 'suffix-lookalike'],
      ['.nytimes.com.evil.test', 'prefix-lookalike'],
      ['.github.com', 'other'],
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(configHome, { recursive: true, force: true });
  });

  it('includes cookies on subdomains of the requested domain', async () => {
    expect(await importFor(['nytimes.com'])).toEqual([
      '.myaccount.nytimes.com',
      '.nytimes.com',
      '.www.nytimes.com',
      'nytimes.com',
      'www.nytimes.com',
    ]);
  });

  it('treats a leading dot on the requested domain the same as none', async () => {
    expect(await importFor(['.nytimes.com'])).toEqual(await importFor(['nytimes.com']));
  });

  it('matches case-insensitively', async () => {
    expect(await importFor(['NYTimes.com'])).toEqual(await importFor(['nytimes.com']));
  });

  it('excludes lookalike hosts that only share a suffix or prefix', async () => {
    const hosts = await importFor(['nytimes.com']);
    expect(hosts).not.toContain('notnytimes.com');
    expect(hosts).not.toContain('.nytimes.com.evil.test');
  });

  it('still excludes expired cookies', async () => {
    const result = await importFor(['nytimes.com']);
    expect(result.filter(h => h === '.nytimes.com')).toHaveLength(1);
  });

  it('a subdomain filter does not pull in sibling subdomains', async () => {
    expect(await importFor(['www.nytimes.com'])).toEqual([
      '.www.nytimes.com',
      'www.nytimes.com',
    ]);
  });
});
