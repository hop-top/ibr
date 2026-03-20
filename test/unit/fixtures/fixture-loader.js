/**
 * Shared fixture loader for T-0014 (static validation), T-0015 (E2E), T-0016 (LLM judge).
 *
 * Exports pure functions — no browser, no AI, no I/O side-effects beyond file reads.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES_ROOT = resolve(__dirname, '../../fixtures');

export const VALID_CATEGORIES = new Set([
  'instruction_types',
  'edge_cases',
  'parsing',
  'extraction',
  'navigation',
]);

export const SUPPORTED_INSTRUCTION_NAMES = new Set([
  'click',
  'fill',
  'type',
  'press',
  'scroll',
  'extract',
  'loop',
  'condition',
]);

// Instruction names that may omit the prompt field
const PROMPT_OPTIONAL = new Set(['loop', 'condition']);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load all fixtures recursively from test/fixtures/.
 *
 * @returns {Promise<Array<{fixture: Object, filePath: string, category: string, name: string}>>}
 */
export async function loadAllFixtures() {
  const entries = await collectJsonFiles(FIXTURES_ROOT);
  const results = [];

  for (const filePath of entries) {
    const raw = await readFile(filePath, 'utf8');
    const fixture = JSON.parse(raw);
    const category = inferCategory(filePath);
    const name = basename(filePath, '.json');
    results.push({ fixture, filePath, category, name });
  }

  return results;
}

/**
 * Validate a fixture object against the required schema.
 * Throws with a descriptive message if invalid.
 *
 * @param {Object} fixture
 * @param {string} filePath  Used in error messages.
 */
export function validateFixtureSchema(fixture, filePath) {
  const label = filePath || '<unknown>';

  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    throw new Error(`${label}: fixture must be a plain object`);
  }

  // Required string fields
  for (const field of ['description', 'category', 'prompt']) {
    if (typeof fixture[field] !== 'string' || fixture[field].trim() === '') {
      throw new Error(`${label}: field "${field}" must be a non-empty string`);
    }
  }

  // category must be one of the valid values
  if (!VALID_CATEGORIES.has(fixture.category)) {
    throw new Error(
      `${label}: invalid category "${fixture.category}". ` +
      `Must be one of: ${[...VALID_CATEGORIES].join(', ')}`
    );
  }

  // expectedParsed
  if (!fixture.expectedParsed || typeof fixture.expectedParsed !== 'object') {
    throw new Error(`${label}: "expectedParsed" must be an object`);
  }
  if (typeof fixture.expectedParsed.url !== 'string') {
    throw new Error(`${label}: "expectedParsed.url" must be a string`);
  }
  if (!Array.isArray(fixture.expectedParsed.instructions)) {
    throw new Error(`${label}: "expectedParsed.instructions" must be an array`);
  }
  if (fixture.expectedParsed.instructions.length === 0) {
    throw new Error(`${label}: "expectedParsed.instructions" must be non-empty`);
  }

  // expectedExtracts
  if (!Array.isArray(fixture.expectedExtracts)) {
    throw new Error(`${label}: "expectedExtracts" must be an array`);
  }

  // instructionCoverage
  if (!Array.isArray(fixture.instructionCoverage)) {
    throw new Error(`${label}: "instructionCoverage" must be an array`);
  }
  for (const name of fixture.instructionCoverage) {
    if (typeof name !== 'string') {
      throw new Error(`${label}: every entry in "instructionCoverage" must be a string`);
    }
  }

  // tags — optional but must be array of strings if present
  if (fixture.tags !== undefined) {
    if (!Array.isArray(fixture.tags)) {
      throw new Error(`${label}: "tags" must be an array`);
    }
    for (const tag of fixture.tags) {
      if (typeof tag !== 'string') {
        throw new Error(`${label}: every entry in "tags" must be a string`);
      }
    }
  }

  // notes — optional string
  if (fixture.notes !== undefined && typeof fixture.notes !== 'string') {
    throw new Error(`${label}: "notes" must be a string`);
  }
}

/**
 * Parse an idx prompt string (the raw CLI format) into {url, instructions}.
 *
 * Format:
 *   url: <url>
 *   instructions:
 *     - <instruction text>
 *     - <instruction text>
 *
 * No AI involved — purely regex/string parsing for static validation purposes.
 * The full AI-based parse lives in Operations.parseTaskDescription().
 *
 * @param {string} prompt
 * @returns {{ url: string, instructions: Array<{name: string, prompt: string}> }}
 */
export function parsePromptString(prompt) {
  if (typeof prompt !== 'string') {
    throw new TypeError('parsePromptString: prompt must be a string');
  }

  // Strip markdown code fences (``` or ```lang at start, ``` at end)
  const stripped = prompt.replace(/^```[^\n]*\n?([\s\S]*?)```\s*$/, '$1').trim();
  const effective = stripped || prompt;

  const lines = effective.split('\n');

  // Extract url: line
  let url = '';
  for (const line of lines) {
    const m = line.match(/^url:\s*(.+)$/i);
    if (m) {
      url = m[1].trim();
      break;
    }
  }

  // Extract bullet instructions under "instructions:" header
  const instructions = [];
  let inInstructions = false;

  for (const line of lines) {
    if (/^instructions\s*:/i.test(line.trim())) {
      inInstructions = true;
      continue;
    }

    if (inInstructions) {
      // Stop at next top-level key (non-indented non-bullet line)
      if (line.trim() && !line.match(/^\s*-/) && !line.match(/^\s/)) {
        inInstructions = false;
        continue;
      }

      const bulletMatch = line.match(/^\s*-\s+(.+)$/);
      if (bulletMatch) {
        const text = bulletMatch[1].trim();
        const parsed = classifyInstruction(text);
        instructions.push(parsed);
      }
    }
  }

  return { url, instructions };
}

/**
 * Validate that a single instruction object satisfies type/prompt rules.
 * Throws if invalid.
 *
 * @param {string} name   Instruction name (e.g. "click")
 * @param {Object} instruction  Full instruction object from expectedParsed
 * @param {string} [filePath]   For error messages
 */
export function validateInstructionType(name, instruction, filePath = '') {
  const label = filePath ? `${filePath} → ${name}` : name;

  if (!SUPPORTED_INSTRUCTION_NAMES.has(name)) {
    throw new Error(
      `${label}: unknown instruction name "${name}". ` +
      `Supported: ${[...SUPPORTED_INSTRUCTION_NAMES].join(', ')}`
    );
  }

  if (!PROMPT_OPTIONAL.has(name)) {
    if (typeof instruction.prompt !== 'string' || instruction.prompt.trim().length === 0) {
      throw new Error(
        `${label}: instruction "${name}" must have a non-empty, non-whitespace "prompt" field.`
      );
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Collect all .json files recursively under root, sorted by path.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function collectJsonFiles(root) {
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(full);
      }
    }
  }

  await walk(root);
  return files.sort();
}

/**
 * Infer category from file path (parent directory name).
 * @param {string} filePath
 * @returns {string}
 */
function inferCategory(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  // Parent dir is the category
  return parts[parts.length - 2] || 'unknown';
}

/**
 * Classify a bullet text into a structured instruction.
 * Looks for leading verb keywords and maps to instruction names.
 *
 * This is a best-effort parse for static test purposes only.
 *
 * @param {string} text
 * @returns {{ name: string, prompt: string }}
 */
function classifyInstruction(text) {
  const lower = text.toLowerCase();

  const VERB_MAP = [
    ['click', 'click'],
    ['fill', 'fill'],
    ['type', 'type'],
    ['press', 'press'],
    ['scroll', 'scroll'],
    ['extract', 'extract'],
    ['loop', 'loop'],
    ['if ', 'condition'],
    ['condition', 'condition'],
  ];

  for (const [prefix, name] of VERB_MAP) {
    if (lower.startsWith(prefix)) {
      return { name, prompt: text };
    }
  }

  // Default: treat as a click instruction
  return { name: 'click', prompt: text };
}
