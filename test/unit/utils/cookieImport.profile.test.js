/**
 * Profile selection — real filesystem + SQLite fixture, no mocks.
 *
 * `last-used` resolves to the profile the browser itself records as most
 * recently used (Local State → profile.last_used). Any other value is a
 * literal profile directory name; `Default` stays the default.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let configHome;
const browserDir = () => path.join(configHome, 'BraveSoftware/Brave-Browser');

function writeProfile(profile, host) {
  const dir = path.join(browserDir(), profile);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'Cookies'));
  db.exec(`CREATE TABLE cookies (
    host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT,
    expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER,
    has_expires INTEGER, samesite INTEGER)`);
  db.prepare(`INSERT INTO cookies VALUES (?, 'n', 'v', x'', '/', 0, 1, 0, 0, 1)`).run(host);
  db.close();
}

function writeLocalState(content) {
  fs.mkdirSync(browserDir(), { recursive: true });
  fs.writeFileSync(path.join(browserDir(), 'Local State'), content);
}

async function load() {
  vi.resetModules();
  return import('../../../src/utils/cookieImport.js?t=' + Date.now());
}

describe.skipIf(process.platform === 'win32')('importCookies — profile selection', () => {
  beforeEach(() => {
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ibr-cookie-profile-'));
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    vi.stubEnv('XDG_CONFIG_HOME', configHome);
    writeProfile('Default', 'default.test');
    writeProfile('Profile 14', 'p14.test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(configHome, { recursive: true, force: true });
  });

  it('reads Default when no profile is given', async () => {
    const { importCookies } = await load();
    const result = await importCookies('brave', []);
    expect(result.profile).toBe('Default');
    expect(result.cookies.map(c => c.domain)).toEqual(['default.test']);
  });

  it('reads a literal profile name as-is', async () => {
    const { importCookies } = await load();
    const result = await importCookies('brave', [], 'Profile 14');
    expect(result.profile).toBe('Profile 14');
    expect(result.cookies.map(c => c.domain)).toEqual(['p14.test']);
  });

  it('last-used resolves to profile.last_used from Local State', async () => {
    writeLocalState(JSON.stringify({ profile: { last_used: 'Profile 14' } }));
    const { importCookies } = await load();
    const result = await importCookies('brave', [], 'last-used');
    expect(result.profile).toBe('Profile 14');
    expect(result.cookies.map(c => c.domain)).toEqual(['p14.test']);
  });

  it('last-used falls back to Default when Local State has no last_used', async () => {
    writeLocalState(JSON.stringify({ profile: {} }));
    const { importCookies } = await load();
    const result = await importCookies('brave', [], 'last-used');
    expect(result.profile).toBe('Default');
  });

  it('last-used errors when Local State is missing', async () => {
    const { importCookies, CookieImportError } = await load();
    await expect(importCookies('brave', [], 'last-used')).rejects.toSatisfy(
      err => err instanceof CookieImportError && err.code === 'profile_unresolved',
    );
  });

  it('last-used errors when Local State is not valid JSON', async () => {
    writeLocalState('{not json');
    const { importCookies, CookieImportError } = await load();
    await expect(importCookies('brave', [], 'last-used')).rejects.toSatisfy(
      err => err instanceof CookieImportError && err.code === 'profile_unresolved',
    );
  });

  it('last-used rejects a last_used value that escapes the browser dir', async () => {
    writeLocalState(JSON.stringify({ profile: { last_used: '../../etc' } }));
    const { importCookies, CookieImportError } = await load();
    await expect(importCookies('brave', [], 'last-used')).rejects.toSatisfy(
      err => err instanceof CookieImportError && err.code === 'bad_request',
    );
  });
});
