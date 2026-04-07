import { describe, it, expect } from 'vitest';
import os from 'os';

import {
  ENTRIES,
  ALIASES,
  NATIVE_CHANNELS,
  canonicalizeChannel,
  getEntry,
  listEntries,
} from '../../../src/browser/registry.js';

describe('registry — ENTRIES', () => {
  it('contains the expected channel ids', () => {
    const ids = listEntries().sort();
    expect(ids).toEqual(['arc', 'brave', 'chrome', 'chromium', 'comet', 'msedge']);
  });

  it('every entry has the required shape', () => {
    for (const id of listEntries()) {
      const e = getEntry(id);
      expect(e).toBeTruthy();
      expect(e.id).toBe(id);
      expect(e.kind).toBe('chromium-launch');
      expect(e.launcher).toBe('playwright-launch');
      expect(e.localProbe).toBeTypeOf('object');
      expect(Array.isArray(e.localProbe.darwin)).toBe(true);
      expect(Array.isArray(e.localProbe.linux)).toBe(true);
      expect(Array.isArray(e.localProbe.win32)).toBe(true);
    }
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
});

describe('registry — getEntry', () => {
  it('returns null for unknown id', () => {
    expect(getEntry('does-not-exist')).toBeNull();
  });

  it('returns the entry by canonical id', () => {
    expect(getEntry('brave').id).toBe('brave');
  });
});
