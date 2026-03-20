# 019 - Authenticated Session Cookies

**Persona:** [CLI User](../personas/cli-user.md)

## Goal

Import real browser cookies into idx so it can access pages that require a
logged-in session, without re-entering credentials.

## Stories

- As a CLI user, I pass `--cookies <browser>` to inherit all non-expired cookies
  from that browser's default profile so idx can reach auth-gated pages.
- As a CLI user, I pass `--cookies <browser>:<d1>,<d2>` to limit import to
  specific domains, avoiding unrelated cookie noise.
- As a CLI user, macOS Keychain prompts me once per browser; after I click
  "Allow" the key is cached for the rest of the process lifetime.
- As a CLI user, I get a clear error if the browser is not installed, if
  Keychain access is denied, or if the DB is corrupt — each with an
  actionable hint.

## Acceptance Criteria

- `--cookies chrome` imports all non-expired cookies from Chrome Default profile.
- `--cookies arc:github.com,linear.app` imports only cookies for those domains.
- DB locked (browser open): idx copies DB to `/tmp` automatically; no error.
- Browser not found: `CookieImportError` with `code: 'not_installed'`.
- Keychain denied: `CookieImportError` with `code: 'keychain_denied'`, hint to
  click "Allow".
- Keychain timeout (>10 s): `CookieImportError` with `code: 'keychain_timeout'`.
- DB corrupt: `CookieImportError` with `code: 'db_corrupt'`.
- macOS only; exits with clear message on Linux/Windows.
- Requires `better-sqlite3`; native build handled by pnpm.
