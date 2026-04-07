/**
 * Tests for capability-seed.js (T-0037).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  KNOWN_BROKEN_FLOWS,
  seedManifest,
  computeSeedSignatures,
} from '../../../src/browser/capability-seed.js';
import { signature } from '../../../src/browser/capability-signature.js';
import { loadManifest, versionKey } from '../../../src/browser/capability-manifest.js';

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ibr-cap-seed-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('KNOWN_BROKEN_FLOWS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(KNOWN_BROKEN_FLOWS)).toBe(true);
    expect(KNOWN_BROKEN_FLOWS.length).toBeGreaterThan(0);
  });

  it('every entry has the required metadata fields', () => {
    for (const flow of KNOWN_BROKEN_FLOWS) {
      expect(typeof flow.description).toBe('string');
      expect(flow.description.length).toBeGreaterThan(0);
      expect(typeof flow.reference).toBe('string');
      expect(flow.reference).toMatch(/^https?:\/\//);
      expect(flow.input).toBeTruthy();
      expect(typeof flow.errorFingerprint).toBe('string');
      expect(typeof flow.fallbackSucceededOn).toBe('string');
    }
  });

  it("each flow's input passes signature() without throwing", () => {
    for (const flow of KNOWN_BROKEN_FLOWS) {
      expect(() => signature(flow.input)).not.toThrow();
    }
  });
});

describe('computeSeedSignatures', () => {
  it('returns parallel array with valid sha256 hex strings', () => {
    const sigs = computeSeedSignatures();
    expect(sigs.length).toBe(KNOWN_BROKEN_FLOWS.length);
    for (const row of sigs) {
      expect(row.signature).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(typeof row.description).toBe('string');
      expect(typeof row.reference).toBe('string');
      expect(row.input).toBeTruthy();
    }
  });

  it('is deterministic across calls', () => {
    const a = computeSeedSignatures().map((r) => r.signature);
    const b = computeSeedSignatures().map((r) => r.signature);
    expect(a).toEqual(b);
  });
});

describe('seedManifest', () => {
  it('throws without lightpandaVersion', async () => {
    await expect(seedManifest({ rootOverride: tmpRoot })).rejects.toThrow(
      /lightpandaVersion is required/,
    );
  });

  it('writes seed entries under the expected versionKey', async () => {
    const result = await seedManifest({
      lightpandaVersion: '1.2.3',
      playwrightVersion: '1.52.0',
      rootOverride: tmpRoot,
    });
    expect(result.seeded).toBe(true);
    expect(result.bucketKey).toBe(versionKey('1.2.3', '1.52.0'));
    expect(result.count).toBe(KNOWN_BROKEN_FLOWS.length);

    const manifest = await loadManifest(tmpRoot);
    const bucket = manifest.entries[result.bucketKey];
    expect(bucket).toBeTruthy();
    expect(Array.isArray(bucket.knownBroken)).toBe(true);
    expect(bucket.knownBroken.length).toBe(KNOWN_BROKEN_FLOWS.length);
  });

  it('records seededAt timestamp on the bucket', async () => {
    const result = await seedManifest({
      lightpandaVersion: '1.2.3',
      playwrightVersion: '1.52.0',
      rootOverride: tmpRoot,
    });
    const manifest = await loadManifest(tmpRoot);
    const bucket = manifest.entries[result.bucketKey];
    expect(typeof bucket.seededAt).toBe('string');
    expect(() => new Date(bucket.seededAt).toISOString()).not.toThrow();
    expect(typeof bucket.recordedAt).toBe('string');
  });

  it('marks each record as seeded with observedCount=0 and lastSeen=null', async () => {
    const result = await seedManifest({
      lightpandaVersion: '1.2.3',
      playwrightVersion: '1.52.0',
      rootOverride: tmpRoot,
    });
    const manifest = await loadManifest(tmpRoot);
    const records = manifest.entries[result.bucketKey].knownBroken;
    for (const row of records) {
      expect(row.seeded).toBe(true);
      expect(row.observedCount).toBe(0);
      expect(row.lastSeen).toBeNull();
      expect(row.signature).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(typeof row.opKind).toBe('string');
    }
  });

  it('preserves description and reference metadata in the written manifest', async () => {
    const result = await seedManifest({
      lightpandaVersion: '1.2.3',
      playwrightVersion: '1.52.0',
      rootOverride: tmpRoot,
    });
    const manifest = await loadManifest(tmpRoot);
    const records = manifest.entries[result.bucketKey].knownBroken;
    for (let i = 0; i < records.length; i += 1) {
      expect(records[i].description).toBe(KNOWN_BROKEN_FLOWS[i].description);
      expect(records[i].reference).toBe(KNOWN_BROKEN_FLOWS[i].reference);
    }
  });

  it('is idempotent — second call with populated bucket is a no-op', async () => {
    const first = await seedManifest({
      lightpandaVersion: '1.2.3',
      playwrightVersion: '1.52.0',
      rootOverride: tmpRoot,
    });
    expect(first.seeded).toBe(true);

    const before = await loadManifest(tmpRoot);
    const beforeJson = JSON.stringify(before);

    const second = await seedManifest({
      lightpandaVersion: '1.2.3',
      playwrightVersion: '1.52.0',
      rootOverride: tmpRoot,
    });
    expect(second.seeded).toBe(false);
    expect(second.count).toBe(KNOWN_BROKEN_FLOWS.length);

    const after = await loadManifest(tmpRoot);
    expect(JSON.stringify(after)).toBe(beforeJson);
  });

  it('falls back to detectPlaywrightVersion() when playwrightVersion is omitted', async () => {
    const result = await seedManifest({
      lightpandaVersion: '1.2.3',
      rootOverride: tmpRoot,
    });
    expect(result.seeded).toBe(true);
    // bucketKey should start with the lightpanda version
    expect(result.bucketKey.startsWith('1.2.3|')).toBe(true);
  });
});
