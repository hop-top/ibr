/**
 * Capability manifest seed.
 *
 * Pre-populates the capability manifest with known-broken lightpanda flows
 * so users get pre-flight warnings before hitting them blind. The seed list
 * is hand-curated from upstream tracking issues — see KNOWN_BROKEN_FLOWS
 * below. Each entry references the upstream issue so future reviewers know
 * why an entry exists and when to drop it.
 *
 * Seeding is one-shot per (lightpandaVersion, playwrightVersion) bucket:
 * `seedManifest()` only writes when the target bucket is empty so we never
 * overwrite organically learned entries from `recordBroken()`.
 *
 * Track: adopt-lightpanda
 * Implemented by: T-0037
 */

import { signature } from './capability-signature.js';
import {
  versionKey,
  loadManifest,
  saveManifest,
  detectPlaywrightVersion,
} from './capability-manifest.js';

/**
 * Static list of known-broken flows as of the last manual review.
 * Each entry is a signature-input triple that will be hashed via
 * capability-signature.signature() at seed time.
 *
 * Adding entries:
 *   - description + reference URL are required (so reviewers know why)
 *   - capture the structural selector shape (not raw locators)
 *   - opKind must be one of the closed OP_KINDS enum
 *   - prefer linking the upstream tracking issue over a blog post
 */
export const KNOWN_BROKEN_FLOWS = [
  {
    description:
      'lightpanda upstream issue #2015: CORS not implemented. '
      + 'Cross-origin fetch inside page.evaluate fails silently '
      + 'or with cryptic error.',
    reference: 'https://github.com/lightpanda-io/browser/issues/2015',
    input: {
      opKind: 'evaluate',
      selector: { role: null, tagName: 'html', hasText: false, depth: 0 },
      stepTemplate: 'fetch cross origin url from page evaluate',
    },
    errorFingerprint: 'fetch failed: CORS not implemented',
    fallbackSucceededOn: 'chromium',
  },
];

/**
 * Seed the capability manifest with known-broken flows for a specific
 * lightpanda version. Only writes if the target bucket is empty — never
 * overwrites existing entries (we're adding a baseline, not pruning
 * learned ones).
 *
 * @param {object} args
 * @param {string} args.lightpandaVersion
 * @param {string} [args.playwrightVersion]  defaults to detectPlaywrightVersion()
 * @param {string} [args.rootOverride]       cache root override (tests)
 * @returns {Promise<{ seeded: boolean, bucketKey: string, count: number }>}
 */
export async function seedManifest({
  lightpandaVersion,
  playwrightVersion,
  rootOverride,
} = {}) {
  if (!lightpandaVersion) {
    throw new Error('capability-seed: lightpandaVersion is required');
  }
  const pw = playwrightVersion ?? detectPlaywrightVersion();
  const key = versionKey(lightpandaVersion, pw);
  const manifest = await loadManifest(rootOverride);

  const bucket = manifest.entries[key];
  if (bucket && Array.isArray(bucket.knownBroken) && bucket.knownBroken.length > 0) {
    return { seeded: false, bucketKey: key, count: bucket.knownBroken.length };
  }

  const now = new Date().toISOString();
  const records = KNOWN_BROKEN_FLOWS.map((flow) => ({
    signature: signature(flow.input),
    opKind: flow.input.opKind,
    errorFingerprint: flow.errorFingerprint,
    observedCount: 0, // seeded, not observed
    lastSeen: null, // never observed on this host
    fallbackSucceededOn: flow.fallbackSucceededOn,
    seeded: true,
    description: flow.description,
    reference: flow.reference,
  }));

  manifest.entries[key] = {
    recordedAt: now,
    seededAt: now,
    knownBroken: records,
  };
  await saveManifest(manifest, rootOverride);

  return { seeded: true, bucketKey: key, count: records.length };
}

/**
 * Expose the computed signatures for dev verification without writing.
 * Used by scripts/verify-seed.js.
 *
 * @returns {Array<{ description: string, reference: string, input: object, signature: string }>}
 */
export function computeSeedSignatures() {
  return KNOWN_BROKEN_FLOWS.map((flow) => ({
    description: flow.description,
    reference: flow.reference,
    input: flow.input,
    signature: signature(flow.input),
  }));
}
