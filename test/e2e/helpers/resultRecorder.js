/**
 * Result recorder for E2E fixture runs (T-0015).
 *
 * Writes one JSON file per fixture to test/results/e2e/.
 * Directory is created if absent.
 * Format consumed by T-0016 (LLM judge).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_ROOT = resolve(__dirname, '../../results/e2e');

/**
 * Write a result file for one fixture.
 *
 * @param {Object} result
 * @param {string} result.fixtureFile      - Absolute path to the fixture JSON
 * @param {string} result.fixtureCategory  - e.g. "instruction_types"
 * @param {string} result.fixtureName      - e.g. "click-basic"
 * @param {string} result.prompt           - Prompt after {SERVER_URL} substitution
 * @param {Object} result.execution        - { status, duration_ms, timestamp }
 * @param {Object} result.parsed           - { expected, actual, matches, match_details, parse_error }
 * @param {Object} result.extracts         - { expected, actual, matches, match_type, structural_notes, extract_error }
 * @param {Object} result.tokens           - { prompt, completion, total }
 * @param {Object} result.ai_provider      - { provider, model, temperature }
 * @param {string[]} result.tags
 * @param {string}  [result.notes]
 */
export async function recordTestResult(result) {
  await mkdir(RESULTS_ROOT, { recursive: true });

  const filename = `${result.fixtureCategory}-${result.fixtureName}.json`;
  const filePath = join(RESULTS_ROOT, filename);

  const output = {
    fixtureFile: result.fixtureFile,
    fixtureCategory: result.fixtureCategory,
    prompt: result.prompt,
    execution: {
      status: result.execution?.status ?? 'error',
      duration_ms: result.execution?.duration_ms ?? 0,
      timestamp: result.execution?.timestamp ?? new Date().toISOString(),
    },
    parsed: {
      expected: result.parsed?.expected ?? null,
      actual: result.parsed?.actual ?? null,
      matches: result.parsed?.matches ?? false,
      match_details: result.parsed?.match_details ?? [],
      parse_error: result.parsed?.parse_error ?? '',
    },
    extracts: {
      expected: result.extracts?.expected ?? null,
      actual: result.extracts?.actual ?? null,
      matches: result.extracts?.matches ?? false,
      match_type: result.extracts?.match_type ?? 'structural',
      structural_notes: result.extracts?.structural_notes ?? '',
      extract_error: result.extracts?.extract_error ?? '',
    },
    tokens: {
      prompt: result.tokens?.prompt ?? 0,
      completion: result.tokens?.completion ?? 0,
      total: result.tokens?.total ?? 0,
    },
    ai_provider: {
      provider: result.ai_provider?.provider ?? '',
      model: result.ai_provider?.model ?? '',
      temperature: result.ai_provider?.temperature ?? 0,
    },
    tags: Array.isArray(result.tags) ? result.tags : [],
    notes: result.notes ?? '',
  };

  await writeFile(filePath, JSON.stringify(output, null, 2), 'utf8');
  return filePath;
}

/**
 * Ensure the results directory exists (idempotent).
 */
export async function ensureResultsDir() {
  await mkdir(RESULTS_ROOT, { recursive: true });
}
