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

// ── [SECTION: CHAIN] ─────────────────────────────────────────────────────────
// T-0025: implement step 1 (exec-path) and step 3 (local probe).
// T-0026: implement step 4 (cache) and step 5 (download).
// T-0030: implement step 2 (cdp-url).

/**
 * Step 1: BROWSER_EXECUTABLE_PATH override.
 * @param {object} env
 * @returns {object|null}
 */
function stepExecPath(env) {
  const ep = env.BROWSER_EXECUTABLE_PATH;
  if (!ep) return null;
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
    throw new Error(
      `Browser "${channelId}" is not supported on ${platform}. ` +
      `Supported values: chrome, msedge, brave, chromium, arc (macOS), comet (macOS). ` +
      `Use BROWSER_EXECUTABLE_PATH to specify a custom path.`
    );
  }

  const found = probePaths(platformCandidates, exists);
  if (!found) {
    throw new Error(
      `Browser "${channelId}" not found on this system. Searched:\n` +
      platformCandidates.map(p => `  ${p}`).join('\n') + '\n' +
      `Install the browser or set BROWSER_EXECUTABLE_PATH to its executable.`
    );
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
// T-0025 stub: only `chromium-launch` is supported. T-0030 adds the other
// kinds + a dispatch table.
//
// Launcher modules are imported lazily so test mocks via vi.mock() take
// effect when the resolver is loaded once at module level.

function dispatch(record, overrides) {
  if (record.kind === 'chromium-launch') {
    return playwrightLaunch.launch({
      executablePath: record.executablePath ?? undefined,
      channel: record.channel ?? undefined,
      launchOptions: overrides,
    });
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
  // Step 1: BROWSER_EXECUTABLE_PATH override
  const exec = stepExecPath(env);
  if (exec) {
    return { record: exec, channelId: null };
  }

  // Step 2 (T-0030): BROWSER_CDP_URL — not yet wired.

  // Step 3: local probe (only when channel is set).
  const channelId = canonicalizeChannel(env.BROWSER_CHANNEL);
  if (channelId) {
    const probed = stepLocalProbe(channelId);
    if (probed) return { record: probed, channelId };
  }

  // Steps 4 + 5 (T-0026): cache + download — not yet wired.

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
 * @param {object} env
 * @param {object} [overrides]  Playwright launch options merged in
 * @returns {Promise<import('./index.js').BrowserHandle>}
 */
export async function resolve(env, overrides = {}) {
  const { record, channelId } = resolveRecord(env);
  emitResolved(record, channelId);
  return dispatch(record, overrides);
}
