/**
 * Unit tests for the ibr output-file surface in src/index.js.
 *
 * Surface under test (all named exports, no run() side-effect):
 *   - parseOutputFlags(argv)       — parses --output/-o + --output-format
 *   - renderExtraction(extracts,f) — deterministic json/markdown rendering
 *   - writeExtractionOutput(cfg,e) — mkdir parent + write file, returns {path,format}
 *
 * A tlc flow `run.ibr` step consumes the written file via `${step.output.path}`
 * (story 072). These tests pin the ibr-side half: the flag parse, the format
 * handling, parent-dir auto-creation, and the additive nature of the file sink
 * (the existing logger line must stay untouched).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Prevent index.js from calling run() on import — stub the entry-point deps.
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));
vi.mock('../../src/ai/provider.js', () => ({ createAIProvider: vi.fn() }));
vi.mock('../../src/Operations.js', () => ({ Operations: vi.fn() }));
vi.mock('../../src/utils/validation.js', () => ({
  validateEnvironmentVariables: vi.fn(),
  validateBrowserConfig: vi.fn(c => c),
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/utils/cookieImport.js', () => ({
  importCookies: vi.fn(),
  getSupportedCookieBrowsersHelpText: vi.fn(() => 'chrome, brave'),
}));
vi.mock('../../src/commands/snap.js', () => ({ runDomCommand: vi.fn() }));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const { parseOutputFlags, renderExtraction, writeExtractionOutput } =
  await import('../../src/index.js');

// A representative extraction: array-of-arrays, each item a {field: value} object
// (matches Operations.extracts shape — one inner array per instruction).
const SAMPLE = [
  [{ title: 'The Headline' }, { publishDate: '2026-08-27' }],
  [{ body: 'First paragraph.\nSecond paragraph.' }],
];

const tmpFiles = [];
function tmpPath(...segs) {
  const p = path.join(os.tmpdir(), `ibr-output-test-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...segs);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  for (const p of tmpFiles.splice(0)) {
    try {
      const root = p.split(path.sep).slice(0, -1).join(path.sep);
      fs.rmSync(root, { recursive: true, force: true });
    } catch { /* best-effort cleanup */ }
  }
  vi.restoreAllMocks();
});

// ── parseOutputFlags ──────────────────────────────────────────────────────────

describe('parseOutputFlags — flag parsing', () => {
  it('returns null when no output flag present', () => {
    expect(parseOutputFlags(['some prompt'])).toBeNull();
  });

  it('--output <path> yields path with default json format', () => {
    const r = parseOutputFlags(['--output', '/tmp/a.json', 'prompt']);
    expect(r).toEqual({ path: '/tmp/a.json', format: 'json' });
  });

  it('-o <path> short form yields path with default json format', () => {
    const r = parseOutputFlags(['-o', '/tmp/a.json', 'prompt']);
    expect(r).toEqual({ path: '/tmp/a.json', format: 'json' });
  });

  it('--output-format markdown is honoured', () => {
    const r = parseOutputFlags(['--output', '/tmp/a.md', '--output-format', 'markdown', 'prompt']);
    expect(r).toEqual({ path: '/tmp/a.md', format: 'markdown' });
  });

  it('--output-format json is honoured explicitly', () => {
    const r = parseOutputFlags(['-o', '/tmp/a.json', '--output-format', 'json']);
    expect(r).toEqual({ path: '/tmp/a.json', format: 'json' });
  });

  it('unknown --output-format throws a CONFIG_ERROR CliError', () => {
    let err;
    try {
      parseOutputFlags(['-o', '/tmp/a.x', '--output-format', 'yaml']);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.message).toMatch(/output-format/);
    expect(err.message).toMatch(/yaml/);
  });

  it('--output with no value throws a CONFIG_ERROR CliError', () => {
    let err;
    try {
      parseOutputFlags(['--output']);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('CONFIG_ERROR');
  });

  it('--output followed by another flag throws (missing value)', () => {
    let err;
    try {
      parseOutputFlags(['--output', '--output-format', 'json']);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('CONFIG_ERROR');
  });
});

// ── renderExtraction ────────────────────────────────────────────────────────────

describe('renderExtraction — deterministic formats', () => {
  it('json format returns pretty-printed JSON of the extracts', () => {
    const out = renderExtraction(SAMPLE, 'json');
    expect(out).toBe(JSON.stringify(SAMPLE, null, 2));
    expect(JSON.parse(out)).toEqual(SAMPLE);
  });

  it('markdown format renders each field as a labelled section', () => {
    const out = renderExtraction(SAMPLE, 'markdown');
    // Deterministic: every extracted field key + its value appears.
    expect(out).toContain('title');
    expect(out).toContain('The Headline');
    expect(out).toContain('publishDate');
    expect(out).toContain('2026-08-27');
    expect(out).toContain('body');
    expect(out).toContain('First paragraph.');
  });

  it('markdown is stable across calls (deterministic)', () => {
    expect(renderExtraction(SAMPLE, 'markdown')).toBe(renderExtraction(SAMPLE, 'markdown'));
  });

  it('empty extracts render without throwing (json)', () => {
    expect(renderExtraction([], 'json')).toBe('[]');
  });

  it('empty extracts render without throwing (markdown)', () => {
    expect(() => renderExtraction([], 'markdown')).not.toThrow();
  });
});

// ── writeExtractionOutput ───────────────────────────────────────────────────────

describe('writeExtractionOutput — file sink', () => {
  it('writes the extraction JSON to the given path', () => {
    const p = tmpPath('article.json');
    const meta = writeExtractionOutput({ path: p, format: 'json' }, SAMPLE);
    expect(fs.existsSync(p)).toBe(true);
    expect(JSON.parse(fs.readFileSync(p, 'utf8'))).toEqual(SAMPLE);
    expect(meta).toEqual({ path: p, format: 'json' });
  });

  it('writes markdown when format is markdown', () => {
    const p = tmpPath('article.md');
    writeExtractionOutput({ path: p, format: 'markdown' }, SAMPLE);
    const content = fs.readFileSync(p, 'utf8');
    expect(content).toContain('The Headline');
    expect(content).toContain('2026-08-27');
    // Must NOT be raw JSON — markdown rendering differs from the json sink.
    expect(content).not.toBe(JSON.stringify(SAMPLE, null, 2));
  });

  it('auto-creates missing parent directories', () => {
    const p = tmpPath('nested', 'deeper', 'article.json');
    expect(fs.existsSync(path.dirname(p))).toBe(false);
    writeExtractionOutput({ path: p, format: 'json' }, SAMPLE);
    expect(fs.existsSync(p)).toBe(true);
  });

  it('returns the {path, format} contract for the flow step to consume', () => {
    const p = tmpPath('out.json');
    const meta = writeExtractionOutput({ path: p, format: 'json' }, SAMPLE);
    expect(meta.path).toBe(p);
    expect(meta.format).toBe('json');
  });
});

// ── additive guarantee (stdout/logger unchanged) ────────────────────────────────

describe('output-file surface is additive', () => {
  it('the logger "Extracted data" line still exists in source', () => {
    // Guard against a refactor that removes the existing stdout/stderr sink.
    const src = fs.readFileSync(
      path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/index.js'),
      'utf8',
    );
    expect(src).toContain('Extracted data');
  });
});
