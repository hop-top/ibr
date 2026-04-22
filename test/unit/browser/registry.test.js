import { describe, it, expect } from 'vitest';

import {
  NATIVE_CHANNELS,
  canonicalizeChannel,
  getEntry,
  listEntries,
} from '../../../src/browser/registry.js';

describe('registry — ENTRIES', () => {
  it('contains the expected channel ids', () => {
    const ids = listEntries().sort();
    expect(ids).toEqual([
      'arc',
      'brave',
      'browser-use',
      'browserless',
      'chrome',
      'chromium',
      'comet',
      'lightpanda',
      'msedge',
      'pod',
    ]);
  });

  it('every entry has the required shape', () => {
    for (const id of listEntries()) {
      const e = getEntry(id);
      expect(e).toBeTruthy();
      expect(e.id).toBe(id);
      expect(['chromium-launch', 'cdp-server', 'cloud-server']).toContain(e.kind);
      if (e.kind === 'chromium-launch') {
        expect(e.launcher).toBe('playwright-launch');
        expect(e.localProbe).toBeTypeOf('object');
        expect(Array.isArray(e.localProbe.darwin)).toBe(true);
        expect(Array.isArray(e.localProbe.linux)).toBe(true);
        expect(Array.isArray(e.localProbe.win32)).toBe(true);
      }
      if (e.kind === 'cdp-server') {
        expect(e.launcher).toBe('playwright-connect');
        expect(e.localProbe).toBeTypeOf('object');
        expect(Array.isArray(e.localProbe.darwin)).toBe(true);
        expect(Array.isArray(e.localProbe.linux)).toBe(true);
        expect(Array.isArray(e.localProbe.win32)).toBe(true);
      }
      if (e.kind === 'cloud-server') {
        expect(e.launcher).toBe('playwright-connect');
        expect(e.urlTemplate).toBeTypeOf('string');
      }
    }
  });

  it('lightpanda is a downloadable cdp-server with github releases config', () => {
    const lp = getEntry('lightpanda');
    expect(lp).toBeTruthy();
    expect(lp.kind).toBe('cdp-server');
    expect(lp.downloadable).toBe(true);
    expect(lp.launcher).toBe('playwright-connect');
    expect(lp.spawner).toBe('lightpanda-spawner');
    expect(lp.releases.provider).toBe('github');
    expect(lp.releases.repo).toBe('lightpanda-io/browser');
    expect(lp.releases.channels.stable.resolver).toBe('newest-non-prerelease');
    expect(lp.releases.channels.nightly.resolver).toBe('tag');
    expect(lp.releases.channels.latest.resolver).toBe('alias');
    expect(lp.localProbe.win32).toEqual([]);
  });

  it('chrome and msedge are flagged as native channels', () => {
    expect(getEntry('chrome').nativeChannel).toBe('chrome');
    expect(getEntry('msedge').nativeChannel).toBe('msedge');
    expect(NATIVE_CHANNELS.has('chrome')).toBe(true);
    expect(NATIVE_CHANNELS.has('msedge')).toBe(true);
  });

  it('brave has macOS probe paths', () => {
    const macPaths = getEntry('brave').localProbe.darwin;
    expect(macPaths).toContain('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  });

  it('arc and comet are macOS-only', () => {
    expect(getEntry('arc').localProbe.linux).toEqual([]);
    expect(getEntry('arc').localProbe.win32).toEqual([]);
    expect(getEntry('comet').localProbe.linux).toEqual([]);
    expect(getEntry('comet').localProbe.win32).toEqual([]);
  });
});

describe('registry — canonicalizeChannel', () => {
  it('returns null for empty / undefined input', () => {
    expect(canonicalizeChannel(undefined)).toBeNull();
    expect(canonicalizeChannel('')).toBeNull();
    expect(canonicalizeChannel(null)).toBeNull();
  });

  it('lowercases unknown channel ids passthrough', () => {
    expect(canonicalizeChannel('Brave')).toBe('brave');
    expect(canonicalizeChannel('CHROMIUM')).toBe('chromium');
  });

  it('normalizes friendly aliases', () => {
    expect(canonicalizeChannel('google-chrome')).toBe('chrome');
    expect(canonicalizeChannel('Google Chrome')).toBe('chrome');
    expect(canonicalizeChannel('edge')).toBe('msedge');
    expect(canonicalizeChannel('microsoft-edge')).toBe('msedge');
    expect(canonicalizeChannel('Microsoft Edge')).toBe('msedge');
  });

  it('trims whitespace', () => {
    expect(canonicalizeChannel('  brave  ')).toBe('brave');
  });

  it('normalizes cloud provider aliases', () => {
    expect(canonicalizeChannel('browser-use')).toBe('browser-use');
    expect(canonicalizeChannel('browserless')).toBe('browserless');
  });
});

describe('registry — getEntry', () => {
  it('returns null for unknown id', () => {
    expect(getEntry('does-not-exist')).toBeNull();
  });

  it('returns the entry by canonical id', () => {
    expect(getEntry('brave').id).toBe('brave');
  });

  it('returns cloud-server entries with url templates', () => {
    expect(getEntry('browser-use')).toMatchObject({
      id: 'browser-use',
      kind: 'cloud-server',
      launcher: 'playwright-connect',
    });
    expect(getEntry('browserless').urlTemplate).toContain('{{key}}');
    expect(getEntry('pod').urlTemplate).toBe('{{key}}');
  });
});
