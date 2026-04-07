/**
 * Capability manifest — self-healing known-broken store for lightpanda.
 *
 * Keyed by (lightpandaVersion, playwrightVersion) tuple. Populated on
 * fallback success: when lightpanda fails and BROWSER_FALLBACK succeeds on
 * fallback browser, record the signature so future runs warn pre-flight.
 *
 * See spec §"Capability manifest" for signature canonical form.
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0031
 */

// TODO(T-0031)
export async function isKnownBroken(versionKey, signature) {
  return false;
}

// TODO(T-0031)
export async function recordBroken(versionKey, record) {
  throw new Error('src/browser/capability-manifest.js not yet implemented');
}
