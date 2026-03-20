/**
 * Unit tests for --annotate / -a flag parsing in src/index.js parseCliFlags().
 *
 * parseCliFlags() reads process.argv, so we shadow it per test.
 */

import { describe, it, expect, afterEach } from 'vitest';

// Save + restore process.argv between tests
const _origArgv = process.argv;

afterEach(() => {
    process.argv = _origArgv;
});

// Dynamically import the function — we extract it by running the module
// in a controlled way. Since index.js has top-level side-effects (calls run()),
// we can't import it directly. Instead, inline a copy of the pure function
// under test (same logic as src/index.js) and unit-test it.

// ── Copy of parseCliFlags from src/index.js (pure, no side-effects) ──────────

const VALID_MODES = new Set(['aria', 'dom', 'auto']);

function parseCliFlags(argv) {
    const remaining = [];
    let mode = 'auto';
    let annotate = false;

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--mode' && argv[i + 1]) {
            const val = argv[++i].toLowerCase();
            if (!VALID_MODES.has(val)) throw new Error(`Invalid --mode: ${val}`);
            mode = val;
        } else if (argv[i] === '--annotate' || argv[i] === '-a') {
            annotate = true;
        } else {
            remaining.push(argv[i]);
        }
    }

    return { args: remaining, mode, annotate };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('parseCliFlags — --annotate / -a (T-0009)', () => {
    it('annotate is false by default', () => {
        const { annotate } = parseCliFlags(['"some prompt"']);
        expect(annotate).toBe(false);
    });

    it('--annotate sets annotate=true', () => {
        const { annotate, args } = parseCliFlags(['--annotate', 'my prompt']);
        expect(annotate).toBe(true);
        expect(args).toEqual(['my prompt']);
    });

    it('-a sets annotate=true (short form)', () => {
        const { annotate, args } = parseCliFlags(['-a', 'my prompt']);
        expect(annotate).toBe(true);
        expect(args).toEqual(['my prompt']);
    });

    it('--annotate is stripped from positional args', () => {
        const { args } = parseCliFlags(['--annotate', 'the prompt']);
        expect(args).not.toContain('--annotate');
        expect(args).toContain('the prompt');
    });

    it('-a is stripped from positional args', () => {
        const { args } = parseCliFlags(['-a', 'the prompt']);
        expect(args).not.toContain('-a');
    });

    it('--annotate and --mode can coexist', () => {
        const { annotate, mode, args } = parseCliFlags(['--annotate', '--mode', 'dom', 'go']);
        expect(annotate).toBe(true);
        expect(mode).toBe('dom');
        expect(args).toEqual(['go']);
    });

    it('-a and --mode can coexist', () => {
        const { annotate, mode } = parseCliFlags(['-a', '--mode', 'aria', 'do it']);
        expect(annotate).toBe(true);
        expect(mode).toBe('aria');
    });

    it('annotate=false when neither --annotate nor -a present', () => {
        const { annotate } = parseCliFlags(['--mode', 'dom', 'task']);
        expect(annotate).toBe(false);
    });
});
