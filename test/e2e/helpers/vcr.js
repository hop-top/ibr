/**
 * VCR helper for CLI e2e tests.
 *
 * Loads a cassette (JSON array of ordered AI response strings) from disk and
 * starts a fake OpenAI-compatible HTTP server that replays them in order.
 *
 * Cassettes use {SERVER_URL} as a placeholder for the static test server's
 * base URL — pass `vars` to substitute at load time.
 *
 * Usage:
 *   import { startFromCassette } from './helpers/vcr.js';
 *   const ai = await startFromCassette('story-005-custom-model', { SERVER_URL: web.baseUrl });
 *   // ... run test ...
 *   await ai.close();
 *
 * Cassettes live in test/e2e/cassettes/<name>.json as a JSON array of strings.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeAIServerE2E } from '../../helpers/fakeAIServerE2E.js';

const CASSETTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../cassettes');

/**
 * Start a fake AI server replaying the named cassette.
 *
 * @param {string} name - Cassette filename without extension
 * @param {Record<string, string>} [vars] - Placeholder substitutions, e.g. { SERVER_URL: '...' }
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
export function startFromCassette(name, vars = {}) {
  const path = resolve(CASSETTES_DIR, `${name}.json`);
  let raw = readFileSync(path, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    raw = raw.replaceAll(`{${key}}`, value);
  }
  const responses = JSON.parse(raw);
  return startFakeAIServerE2E(responses);
}
