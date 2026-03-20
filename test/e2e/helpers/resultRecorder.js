/**
 * Result recorder for T-0015 E2E fixture tests.
 *
 * Writes per-fixture result JSON to test/results/e2e/<category>__<name>.json
 * Output consumed by T-0016 (LLM judge).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '../../results/e2e');

/**
 * Ensure results directory exists.
 * @returns {Promise<string>} Absolute path of the results directory
 */
export async function ensureResultsDir() {
  await mkdir(RESULTS_DIR, { recursive: true });
  return RESULTS_DIR;
}

/**
 * Record a fixture test result to disk.
 *
 * @param {Object} params
 * @param {string} params.fixtureFile       Absolute path to fixture JSON
 * @param {string} params.fixtureCategory   Category string (e.g. 'instruction_types')
 * @param {string} params.fixtureName       Fixture base name (e.g. 'click-basic')
 * @param {string} params.prompt            Prompt after {SERVER_URL} substitution
 * @param {Object} params.execution         { status, duration_ms, timestamp }
 * @param {Object} params.parsed            { expected, actual, matches, match_details, parse_error? }
 * @param {Object} params.extracts          { expected, actual, matches, match_type,
 *                                           structural_notes?, extract_error? }
 * @param {Object} params.tokens            { prompt, completion, total }
 * @param {Object} params.aiProvider        { provider, model, temperature }
 * @param {string[]} params.tags
 * @param {string}  [params.notes]
 * @returns {Promise<string>}               Absolute path of written file
 */
export async function recordTestResult({
  fixtureFile,
  fixtureCategory,
  fixtureName,
  prompt,
  execution,
  parsed,
  extracts,
  tokens,
  aiProvider,
  tags,
  notes,
}) {
  await ensureResultsDir();

  const slug = `${fixtureCategory}__${fixtureName}`;
  const outPath = join(RESULTS_DIR, `${slug}.json`);

  const record = {
    fixtureFile,
    fixtureCategory,
    prompt,
    execution,
    parsed,
    extracts,
    tokens,
    ai_provider: aiProvider,
    tags: tags ?? [],
    ...(notes !== undefined ? { notes } : {}),
  };

  await writeFile(outPath, JSON.stringify(record, null, 2), 'utf8');
  return outPath;
}
