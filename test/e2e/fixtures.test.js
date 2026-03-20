/**
 * T-0015 — Tier 2: E2E AI-Agent Browser Testing
 *
 * Runs each fixture from test/fixtures/ through a real Playwright browser
 * and real AI provider (determined by AI_PROVIDER env var).
 *
 * Produces result files in test/results/e2e/<category>-<name>.json for
 * T-0016 (LLM judge) to score.
 *
 * Timeout: 90s per fixture (real AI calls)
 * Pool: forks (inherited from vitest.config.js)
 *
 * Tag-based filtering via --grep:
 *   npm run test:e2e                        # all fixtures
 *   npm run test:e2e:fast                   # @fast only
 *   vitest run ... --grep @extraction       # extraction fixtures
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { loadAllFixtures } from '../unit/fixtures/fixture-loader.js';
import { startStaticServer } from '../helpers/staticServer.js';
import { matchParsed, matchExtracts } from './helpers/structuralMatcher.js';
import { recordTestResult } from './helpers/resultRecorder.js';
import { createAIProvider } from '../../src/ai/provider.js';
import { Operations } from '../../src/Operations.js';

// ── Shared state ──────────────────────────────────────────────────────────────

let staticServer;
let fixtures = [];
const TEST_TIMEOUT = 90_000;
const MAX_FIXTURE_SLOTS = 50;

// ── Suite setup / teardown ───────────────────────────────────────────────────

beforeAll(async () => {
  staticServer = await startStaticServer();
  fixtures = await loadAllFixtures();
  if (fixtures.length > MAX_FIXTURE_SLOTS) {
    throw new Error(
      `Loaded ${fixtures.length} fixtures, but MAX_FIXTURE_SLOTS is ${MAX_FIXTURE_SLOTS}. ` +
      'Increase MAX_FIXTURE_SLOTS or reduce the number of fixtures.'
    );
  }
}, 30_000);

afterAll(async () => {
  if (staticServer) {
    await staticServer.close();
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Substitute {SERVER_URL} placeholder in a string.
 */
function applyServerUrl(text, baseUrl) {
  return text.replace(/\{SERVER_URL\}/g, baseUrl);
}

/**
 * Build a real Playwright browser + Operations instance.
 * Returns { operations, cleanup }.
 */
async function buildRealOperations(aiProvider) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const operations = new Operations({ aiProvider, page }, { mode: 'dom' });

  async function cleanup() {
    try { await page.close(); } catch { /* ignore */ }
    try { await browser.close(); } catch { /* ignore */ }
  }

  return { operations, cleanup };
}

/**
 * Extract token usage from an Operations instance.
 */
function extractTokens(operations) {
  const u = operations.tokenUsage ?? {};
  return { prompt: u.prompt ?? 0, completion: u.completion ?? 0, total: u.total ?? 0 };
}

/**
 * Core fixture runner — shared by all test slots.
 *
 * @param {{ fixture, filePath, category, name }} entry
 */
async function runFixture(entry) {
  const { fixture, filePath, category, name } = entry;
  const tags = fixture.tags ?? [];

  const baseUrl = staticServer.baseUrl;
  const prompt = applyServerUrl(fixture.prompt, baseUrl);
  const expectedParsed = {
    ...fixture.expectedParsed,
    url: applyServerUrl(fixture.expectedParsed.url, baseUrl),
  };

  const aiProvider = createAIProvider();
  const { operations, cleanup } = await buildRealOperations(aiProvider);

  const startMs = Date.now();
  let execStatus = 'success';
  let parseError = '';
  let extractError = '';
  let parsed = null;
  let parseResult = null;
  let extractResult = null;

  try {
    // ── Step 1: parse via real AI ─────────────────────────────────────────
    try {
      parsed = await operations.parseTaskDescription(prompt);
    } catch (err) {
      parseError = err.message ?? String(err);
      execStatus = 'error';
    }

    // ── Step 2: structural match on parse output ──────────────────────────
    const parsedMatch = matchParsed(expectedParsed, parsed);
    parseResult = {
      expected: expectedParsed,
      actual: parsed,
      matches: parsedMatch.matches,
      match_details: parsedMatch.match_details,
      parse_error: parseError,
    };

    // ── Step 3: execute task (only when parse succeeded) ──────────────────
    if (parsed && !parseError) {
      try {
        await operations.executeTask(parsed);
      } catch (err) {
        extractError = err.message ?? String(err);
        execStatus = 'error';
      }
    }

    // ── Step 4: structural match on extracts ──────────────────────────────
    const extractsMatch = matchExtracts(fixture.expectedExtracts, operations.extracts);
    extractResult = {
      expected: fixture.expectedExtracts,
      actual: operations.extracts,
      matches: extractsMatch.matches,
      match_type: extractsMatch.match_type,
      structural_notes: extractsMatch.structural_notes ?? '',
      extract_error: extractError,
    };

    // ── Step 5: assert structural integrity ───────────────────────────────
    const failedParseDetails = parsedMatch.match_details.filter(d => !d.match);
    expect(
      parsedMatch.matches,
      `[${category}/${name}] parsed structural mismatch:\n` +
      JSON.stringify(failedParseDetails, null, 2)
    ).toBe(true);

    const failedExtractDetails = (extractsMatch.match_details ?? []).filter(d => d.match === false);
    expect(
      extractsMatch.matches,
      `[${category}/${name}] extracts structural mismatch:\n` +
      JSON.stringify(failedExtractDetails, null, 2)
    ).toBe(true);

  } finally {
    await cleanup();

    // Always write result file — even on failure (for T-0016 judge)
    await recordTestResult({
      fixtureFile: filePath,
      fixtureCategory: category,
      fixtureName: name,
      prompt,
      execution: {
        status: execStatus,
        duration_ms: Date.now() - startMs,
        timestamp: new Date(startMs).toISOString(),
      },
      parsed: parseResult ?? {
        expected: expectedParsed,
        actual: null,
        matches: false,
        match_details: [],
        parse_error: parseError,
      },
      extracts: extractResult ?? {
        expected: fixture.expectedExtracts,
        actual: null,
        matches: false,
        match_type: 'structural',
        structural_notes: '',
        extract_error: extractError,
      },
      tokens: extractTokens(operations),
      ai_provider: {
        provider: aiProvider.provider,
        model: aiProvider.model,
        temperature: 0,
      },
      tags,
      notes: fixture.notes ?? '',
    });
  }
}

// ── Test suite ───────────────────────────────────────────────────────────────
//
// Fixture list is populated in beforeAll(), not at module parse time.
// Vitest requires static test names, so we pre-register slots (0..MAX-1).
// Each slot reads fixtures[i] at runtime; unused slots exit immediately.
//
// Each fixture is registered ONCE. The test title embeds ALL tags so that
// `--grep @fast` / `--grep @extraction` selects the right tests without
// duplicate runs.  Example title: "extraction/form-submit [@fast @extraction]"

describe('E2E fixture suite', () => {
  for (let i = 0; i < MAX_FIXTURE_SLOTS; i++) {
    it(`fixture[${i}]`, { timeout: TEST_TIMEOUT }, async () => {
      const entry = fixtures[i];
      if (!entry) return; // slot unused — skip

      const tags = entry.fixture.tags ?? [];
      const tagStr = tags.map(t => `@${t}`).join(' ');
      // Title: "category/name [@tag1 @tag2]" — used by --grep for filtering.
      void `${entry.category}/${entry.name}${tagStr ? ` [${tagStr}]` : ''}`;

      await runFixture(entry);
    });
  }
});
