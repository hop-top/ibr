/**
 * Browser resolution chain.
 *
 * Given an env, walk priority-ordered steps until one yields a resolution
 * record, then dispatch to the appropriate launcher.
 *
 * Chain order (see spec):
 *   1. BROWSER_EXECUTABLE_PATH → verbatim override
 *   2. BROWSER_CDP_URL (or deprecated LIGHTPANDA_WS) → connect-only  (T-0030)
 *   3. local probe → system install
 *   4. managed cache → ~/.cache/ibr/browsers/<channel>/<version>/   (T-0026)
 *   5. download → only if registry entry downloadable: true         (T-0026)
 *
 * Each step returns null (try next) or a resolution record:
 *   { kind, source, version, executablePath?, wsEndpoint?, channel? }
 *
 * Sections:
 *   [SECTION: CHAIN]              — chain step dispatch (T-0025)
 *   [SECTION: LIFECYCLE_DISPATCH] — pick launcher kind → module (T-0025 stub)
 *   [SECTION: EVENTS]             — NDJSON event emission (T-0025)
 *   [SECTION: PUBLIC_API]         — resolve() entry point
 *
 * Track: adopt-lightpanda
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { canonicalizeChannel, getEntry, NATIVE_CHANNELS } from './registry.js';
import * as playwrightLaunch from './launchers/playwright-launch.js';
import * as acquirer from './acquirer.js';
import {
  isKnownBroken,
  recordBroken,
  versionKey,
  detectPlaywrightVersion,
  fingerprintError,
} from './capability-manifest.js';
import { signature as buildSignature } from './capability-signature.js';

// ── [SECTION: CHAIN] ─────────────────────────────────────────────────────────
// T-0025: implement step 1 (exec-path) and step 3 (local probe).
// T-0026: implement step 4 (cache) and step 5 (download).
// T-0030: implement step 2 (cdp-url) + cdp-server lifecycle dispatch.

/**
 * Emit a deprecation NDJSON event to stderr. Best-effort; never throws.
 * @param {string} envName
 * @param {string} replacement
 */
function emitDeprecation(envName, replacement) {
  try {
    process.stderr.write(
      JSON.stringify({ event: 'browser.deprecation', env: envName, use: replacement }) + '\n',
    );
  } catch {
    // never fail on telemetry
  }
}

/**
 * Step 2: BROWSER_CDP_URL / LIGHTPANDA_WS — connect-only mode.
 * @param {object} env
 * @returns {object|null}
 */
function stepCdpUrl(env) {
  const cdpUrl = env.BROWSER_CDP_URL;
  if (cdpUrl) {
    return {
      kind: 'cdp-server',
      source: 'cdp-url',
      version: null,
      wsEndpoint: cdpUrl,
      channel: 'lightpanda',
    };
  }
  const legacy = env.LIGHTPANDA_WS;
  if (legacy) {
    emitDeprecation('LIGHTPANDA_WS', 'BROWSER_CDP_URL');
    return {
      kind: 'cdp-server',
      source: 'cdp-url',
      version: null,
      wsEndpoint: legacy,
      channel: 'lightpanda',
    };
  }
  return null;
}

/**
 * Step 1: BROWSER_EXECUTABLE_PATH override.
 *
 * Special case: if BROWSER_CHANNEL=lightpanda is also set, treat the exec path
 * as a lightpanda binary and produce a cdp-server record (ibr-owned spawn).
 *
 * @param {object} env
 * @returns {object|null}
 */
function stepExecPath(env) {
  const ep = env.BROWSER_EXECUTABLE_PATH;
  if (!ep) return null;
  const channelId = canonicalizeChannel(env.BROWSER_CHANNEL);
  if (channelId === 'lightpanda') {
    return {
      kind: 'cdp-server',
      source: 'exec-path',
      version: null,
      executablePath: ep,
      channel: 'lightpanda',
    };
  }
  return {
    kind: 'chromium-launch',
    source: 'exec-path',
    version: null,
    executablePath: ep,
    channel: null,
  };
}

/**
 * Expand a win32 relative path using %SystemDrive%.
 */
function expandWin32Path(rel) {
  if (path.isAbsolute(rel)) return rel;
  const drive = process.env.SystemDrive || 'C:';
  return path.join(drive + path.sep, rel);
}

/**
 * Probe a list of paths and return the first that exists.
 * Exposed for testing via dependency injection in step 3.
 * @param {string[]} candidates
 * @param {(p: string) => boolean} [exists]
 */
export function probePaths(candidates, exists = fs.existsSync) {
  for (const p of candidates) {
    try {
      if (exists(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Step 3: local probe via registry entry.localProbe.
 *
 * Native channels (no localProbe paths but nativeChannel set) short-circuit
 * to a `nativeChannel` resolution — Playwright resolves the path itself.
 *
 * @param {string|null} channelId  canonical id
 * @param {object}      [opts]
 * @param {string}      [opts.platform]
 * @param {(p: string) => boolean} [opts.exists]
 * @returns {object|null}
 */
function stepLocalProbe(channelId, { platform = os.platform(), exists = fs.existsSync } = {}) {
  if (!channelId) return null;

  const entry = getEntry(channelId);

  // Playwright-native fast path: pass channel through, no probe required.
  if (NATIVE_CHANNELS.has(channelId)) {
    return {
      kind: 'chromium-launch',
      source: 'probe',
      version: null,
      channel: entry?.nativeChannel ?? channelId,
      executablePath: null,
    };
  }

  if (!entry) {
    throw new Error(
      `Browser "${channelId}" is not a known registry entry. ` +
      `Supported values: chrome, msedge, brave, chromium, arc (macOS), comet (macOS). ` +
      `Use BROWSER_EXECUTABLE_PATH to specify a custom path.`
    );
  }

  const platformCandidatesRaw = entry.localProbe?.[platform] ?? [];
  const platformCandidates = platform === 'win32'
    ? platformCandidatesRaw.map(expandWin32Path)
    : platformCandidatesRaw;

  if (platformCandidates.length === 0) {
    if (entry.downloadable) {
      // Defer to acquirer (cache/download) when no probe candidates exist.
      return null;
    }
    throw new Error(
      `Browser "${channelId}" is not supported on ${platform}. ` +
      `Supported values: chrome, msedge, brave, chromium, arc (macOS), comet (macOS). ` +
      `Use BROWSER_EXECUTABLE_PATH to specify a custom path.`
    );
  }

  const found = probePaths(platformCandidates, exists);
  if (!found) {
    if (entry.downloadable) {
      // Defer to acquirer (cache/download).
      return null;
    }
    throw new Error(
      `Browser "${channelId}" not found on this system. Searched:\n` +
      platformCandidates.map(p => `  ${p}`).join('\n') + '\n' +
      `Install the browser or set BROWSER_EXECUTABLE_PATH to its executable.`
    );
  }

  // cdp-server entries (lightpanda) get a cdp-server record so dispatch
  // wires the spawner + connector instead of playwright.launch().
  if (entry.kind === 'cdp-server') {
    return {
      kind: 'cdp-server',
      source: 'probe',
      version: null,
      executablePath: found,
      channel: entry.id,
    };
  }

  return {
    kind: 'chromium-launch',
    source: 'probe',
    version: null,
    executablePath: found,
    channel: null,
  };
}

// ── [SECTION: LIFECYCLE_DISPATCH] ────────────────────────────────────────────
// T-0025: chromium-launch via static playwright-launch import.
// T-0030: cdp-server via lazy lightpanda-spawner + playwright-connect imports.
//
// playwright-launch is statically imported to preserve test timing assumptions
// in test/unit/index.flags.test.js (lazy import would defer Playwright module
// load past flag-handling and break those tests). cdp-server launchers are
// lazy so vi.mock() in dispatch tests can substitute them at resolver-load
// time without forcing Playwright load on every chain test.
//
// Three lifecycle modes for cdp-server (all return BrowserHandle shape):
//   1. connect-only       (record.source === 'cdp-url') — user owns process
//   2. ibr-owned spawn    (probe / cache / download)    — ibr spawns + kills
// In all three, close() varies:
//   - connect-only:  browser.close() only  (disconnect; no kill)
//   - ibr-owned:     browser.close() + spawnHandle.kill()

async function dispatch(record, overrides, env) {
  if (record.kind === 'chromium-launch') {
    const handle = await playwrightLaunch.launch({
      executablePath: record.executablePath ?? undefined,
      channel: record.channel ?? undefined,
      launchOptions: overrides,
    });
    handle.ownership = 'launch';
    return handle;
  }

  if (record.kind === 'cdp-server') {
    const connector = await import('./launchers/playwright-connect.js');

    if (record.source === 'cdp-url') {
      // Connect-only — user (or external daemon) owns the process.
      const connected = await connector.connect({
        wsEndpoint: record.wsEndpoint,
        contextOptions: overrides,
      });
      connected.ownership = 'connect-user';
      return connected;
    }

    // ibr-owned spawn (source: probe | cache | download | exec-path).
    if (!record.executablePath) {
      throw new Error(
        `resolver: cdp-server record missing executablePath (source=${record.source})`,
      );
    }
    const spawner = await import('./launchers/lightpanda-spawner.js');
    const spawnHandle = await spawner.spawn({
      binPath: record.executablePath,
      obeyRobots: env && env.OBEY_ROBOTS === 'true',
      env,
    });

    let connected;
    try {
      connected = await connector.connect({
        wsEndpoint: spawnHandle.wsEndpoint,
        contextOptions: overrides,
      });
    } catch (err) {
      try { spawnHandle.kill(); } catch { /* already gone */ }
      throw err;
    }

    return {
      browser: connected.browser,
      context: connected.context,
      ownership: 'spawn-ibr',
      spawnHandle,
      close: async () => {
        try { await connected.close(); } catch { /* disconnect may throw after child exit */ }
        try { spawnHandle.kill(); } catch { /* already dead */ }
      },
    };
  }

  throw new Error(`Unsupported backend kind: ${record.kind}`);
}

// ── [SECTION: EVENTS] ────────────────────────────────────────────────────────
// NDJSON event emission helper. Writes JSON line to stderr matching ibr's
// existing agent contract.

/**
 * Emit a `browser.resolved` NDJSON event to stderr.
 * @param {object} record  resolution record
 * @param {string|null} channelId
 */
export function emitResolved(record, channelId) {
  const payload = {
    event: 'browser.resolved',
    channel: channelId ?? null,
    source: record.source,
    version: record.version ?? null,
    kind: record.kind,
  };
  if (record.executablePath) payload.executablePath = record.executablePath;
  if (record.wsEndpoint) payload.wsEndpoint = record.wsEndpoint;
  try {
    process.stderr.write(JSON.stringify(payload) + '\n');
  } catch {
    // never fail a launch on logging
  }
}

// ── [SECTION: PUBLIC_API] ────────────────────────────────────────────────────

/**
 * Resolve env to a chain record + channelId pair (no launch).
 *
 * Used both internally by resolve() and externally by the
 * back-compat shim in src/utils/browserChannel.js.
 *
 * @param {object} env
 * @returns {{ record: object, channelId: string|null }}
 */
export function resolveRecord(env) {
  // Step 1: BROWSER_EXECUTABLE_PATH override (with lightpanda special case).
  const exec = stepExecPath(env);
  if (exec) {
    const channelId = canonicalizeChannel(env.BROWSER_CHANNEL);
    return { record: exec, channelId: exec.channel ?? channelId ?? null };
  }

  // Step 2 (T-0030): BROWSER_CDP_URL / LIGHTPANDA_WS — connect-only.
  const cdp = stepCdpUrl(env);
  if (cdp) {
    return { record: cdp, channelId: cdp.channel ?? null };
  }

  // Step 3: local probe (only when channel is set).
  const channelId = canonicalizeChannel(env.BROWSER_CHANNEL);
  if (channelId) {
    const probed = stepLocalProbe(channelId);
    if (probed) return { record: probed, channelId };
    // Probe miss for a downloadable entry — caller (resolve()) must run
    // the acquirer chain. We mark this with a sentinel record so resolve()
    // can branch without re-walking the chain.
    const entry = getEntry(channelId);
    if (entry?.downloadable) {
      return {
        record: { kind: '__needs_acquire__', entry, channelId },
        channelId,
      };
    }
  }

  // Default: Playwright's bundled Chromium, no exec path / no channel.
  return {
    record: {
      kind: 'chromium-launch',
      source: 'default',
      version: null,
      executablePath: null,
      channel: null,
    },
    channelId: null,
  };
}

/**
 * Probe-only resolution for the back-compat shim.
 *
 * Returns the legacy `{ channel?, executablePath? }` shape that the old
 * resolveBrowserChannel() produced. Does NOT emit events, does NOT launch.
 *
 * @param {string|undefined} channelRaw
 * @returns {{ channel?: string, executablePath?: string }}
 */
export function resolveProbeOnly(channelRaw) {
  if (!channelRaw) return {};
  const channelId = canonicalizeChannel(channelRaw);
  const record = stepLocalProbe(channelId);
  const out = {};
  if (record.channel) out.channel = record.channel;
  if (record.executablePath) out.executablePath = record.executablePath;
  return out;
}

/**
 * Resolve env → BrowserHandle. Walks chain, dispatches to launcher,
 * emits a `browser.resolved` NDJSON event.
 *
 * Public entry point — delegates to resolveWithCapability(), which wraps
 * resolveInner() with self-healing fallback logic. See [SECTION: CAPABILITY].
 *
 * @param {object} env
 * @param {object} [overrides]  Playwright launch options merged in
 * @returns {Promise<import('./index.js').BrowserHandle>}
 */
export async function resolve(env, overrides = {}) {
  return resolveWithCapability(env, overrides);
}

async function resolveInner(env, overrides = {}) {
  let { record, channelId } = resolveRecord(env);

  // Steps 4 + 5: cache + download via acquirer (cdp-server downloadable only).
  if (record.kind === '__needs_acquire__') {
    const { entry } = record;
    let acquired;
    try {
      acquired = await acquirer.acquire(entry, { env });
    } catch (err) {
      throw new Error(
        `resolver: failed to acquire "${entry.id}": ${err && err.message ? err.message : String(err)}`,
      );
    }
    if (entry.kind === 'cdp-server') {
      record = {
        kind: 'cdp-server',
        source: acquired.source,
        version: acquired.version ?? null,
        executablePath: acquired.executablePath,
        channel: entry.id,
      };
    } else {
      record = {
        kind: 'chromium-launch',
        source: acquired.source,
        version: acquired.version ?? null,
        executablePath: acquired.executablePath,
        channel: null,
      };
    }
  }

  emitResolved(record, channelId);
  return dispatch(record, overrides, env);
}

// ── [SECTION: CAPABILITY] ────────────────────────────────────────────────────
// T-0031: self-healing capability manifest hooks.
//
// Two layers of protection wrap resolveInner():
//
//   1. Strict-mode preflight (launch-level only)
//      If BROWSER_STRICT=true and BROWSER_CHANNEL=lightpanda, refuse to
//      even attempt launch when the manifest already has launch-time
//      known-broken entries for the current (lp, pw) version key.
//
//   2. Fallback wrapper
//      If lightpanda fails to launch and BROWSER_FALLBACK is set, retry
//      on the fallback channel. On fallback success, record the launch
//      failure under a canonical "launch" signature and emit
//      `capability.learned` + `browser.fallback` NDJSON. On fallback
//      failure, propagate the fallback's error WITHOUT polluting the
//      manifest.
//
// LIMITATION — coarse launch-time entries:
//   At launch failure time we usually don't know the lightpanda version
//   (resolveInner threw before acquirer could surface it). We therefore
//   fall back to lightpandaVersion='unknown' in versionKey(), which means
//   different lightpanda releases collapse into the same bucket for
//   launch-level evidence. observedCount + lastSeen still distinguish
//   recent failures, and op-time callers (preflightCheck) get version-
//   accurate buckets via their own version source. Future work can plumb
//   the partial version through resolveInner so launch entries also become
//   version-accurate.

const LAUNCH_SELECTOR = Object.freeze({
  role: null,
  tagName: 'browser',
  hasText: false,
  depth: 0,
});

/**
 * Build the canonical launch-time signature. Version-independent so
 * different launch failures coalesce into a single signature row whose
 * observedCount tracks how often launches misbehave for this lightpanda
 * install.
 *
 * @returns {string}
 */
function signatureLaunch() {
  return buildSignature({
    opKind: 'launch',
    selector: LAUNCH_SELECTOR,
    stepTemplate: 'launch lightpanda',
  });
}

/**
 * Best-effort NDJSON emit to stderr. Mirrors emitResolved but for
 * capability/fallback events.
 * @param {object} payload
 */
function emitCapabilityEvent(payload) {
  try {
    process.stderr.write(JSON.stringify(payload) + '\n');
  } catch {
    // never fail a launch on telemetry
  }
}

/**
 * Op-level preflight check for callers (Operations.js, etc.). NOT wired
 * into the resolver chain itself — caller invokes this around each
 * specific operation it's about to dispatch.
 *
 * Returns:
 *   { status: 'ok' }                       — no record found
 *   { status: 'warn',   entry, reason }    — known-broken (advisory)
 *   { status: 'refuse', entry, reason }    — known-broken + STRICT mode
 *
 * @param {object} env
 * @param {object} args
 * @param {string} args.opKind
 * @param {object} args.selector
 * @param {string} args.stepTemplate
 * @param {string} [args.lightpandaVersion]
 * @returns {Promise<{status: 'ok'|'warn'|'refuse', reason?: string, entry?: object}>}
 */
export async function preflightCheck(env, { opKind, selector, stepTemplate, lightpandaVersion } = {}) {
  if (canonicalizeChannel(env?.BROWSER_CHANNEL) !== 'lightpanda') {
    return { status: 'ok' };
  }
  let sig;
  try {
    sig = buildSignature({ opKind, selector, stepTemplate });
  } catch {
    return { status: 'ok' };
  }
  const key = versionKey(lightpandaVersion || 'unknown', detectPlaywrightVersion());
  const entry = await isKnownBroken(key, sig);
  if (!entry) return { status: 'ok' };
  if (env.BROWSER_STRICT === 'true') {
    return {
      status: 'refuse',
      entry,
      reason:
        `Refusing to run ${opKind} on lightpanda: signature ${sig} is known-broken ` +
        `(observed ${entry.observedCount}x, last seen ${entry.lastSeen}). ` +
        `Set BROWSER_FALLBACK=<channel> or unset BROWSER_STRICT to retry.`,
    };
  }
  return {
    status: 'warn',
    entry,
    reason:
      `lightpanda ${opKind} signature ${sig} is known-broken ` +
      `(observed ${entry.observedCount}x). Will attempt anyway.`,
  };
}

/**
 * Public resolve() body. Wraps resolveInner with strict preflight (launch
 * level only) and the on-failure fallback path.
 */
async function resolveWithCapability(env, overrides) {
  const channel = canonicalizeChannel(env?.BROWSER_CHANNEL);

  // Strict-mode launch-level preflight: refuse before even trying
  // lightpanda when the manifest has launch entries for the current
  // (lp, pw) bucket. lightpandaVersion is unknown at this point — we
  // check the 'unknown|<pw>' bucket. Op-level strict checks are the
  // caller's responsibility (see preflightCheck above).
  if (env?.BROWSER_STRICT === 'true' && channel === 'lightpanda') {
    try {
      const key = versionKey('unknown', detectPlaywrightVersion());
      const launchSig = signatureLaunch();
      const hit = await isKnownBroken(key, launchSig);
      if (hit) {
        const reason =
          `Refusing to launch lightpanda under BROWSER_STRICT=true: launch signature is ` +
          `known-broken (observed ${hit.observedCount}x, last seen ${hit.lastSeen}). ` +
          `Set BROWSER_FALLBACK=<channel> or unset BROWSER_STRICT to retry.`;
        const err = new Error(reason);
        err.code = 'BROWSER_STRICT_REFUSE';
        throw err;
      }
    } catch (err) {
      if (err && err.code === 'BROWSER_STRICT_REFUSE') throw err;
      // manifest read failure — degrade open, do not block launch
    }
  }

  try {
    return await resolveInner(env, overrides);
  } catch (err) {
    if (channel !== 'lightpanda' || !env?.BROWSER_FALLBACK) throw err;

    const fallback = env.BROWSER_FALLBACK;
    const fallbackEnv = { ...env, BROWSER_CHANNEL: fallback };
    delete fallbackEnv.BROWSER_FALLBACK;

    let handle;
    try {
      handle = await resolveInner(fallbackEnv, overrides);
    } catch (fallbackErr) {
      // Don't pollute manifest if fallback also fails — propagate the
      // fallback's error so the user sees the most relevant failure.
      throw fallbackErr;
    }

    // Fallback succeeded: learn from the failure.
    const fingerprint = fingerprintError(err);
    try {
      await recordBroken(versionKey('unknown', detectPlaywrightVersion()), {
        signature: signatureLaunch(),
        opKind: 'launch',
        errorFingerprint: fingerprint,
        fallbackSucceededOn: fallback,
      });
    } catch {
      // recording failure must not break the live request
    }
    emitCapabilityEvent({
      event: 'capability.learned',
      channel: 'lightpanda',
      fallback,
      opKind: 'launch',
    });
    emitCapabilityEvent({
      event: 'browser.fallback',
      from: 'lightpanda',
      to: fallback,
      reason: fingerprint,
    });
    return handle;
  }
}
