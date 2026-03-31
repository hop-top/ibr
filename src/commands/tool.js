/**
 * `ibr tool <name> [--param key=value ...]`
 *
 * Loads a YAML tool definition from tools/<name>.yaml (or an absolute/relative
 * path), interpolates {{param}} placeholders, and returns a prompt string
 * suitable for the standard ibr execution path.
 *
 * Tool YAML format:
 *
 *   name: web-search
 *   description: "Search the web for a query"
 *   params:
 *     - name: query
 *       description: "Search query"
 *       required: true
 *     - name: count
 *       description: "Number of results"
 *       default: "5"
 *   url: "https://www.google.com"
 *   instructions:
 *     - search for {{query}}
 *     - extract the top {{count}} results with their URLs
 *
 * Interpolation:
 *   - {{param}} → value from --param param=value
 *   - Missing required param → error
 *   - Missing optional param with default → default value
 *   - Extra --param values not declared in params → allowed (passed through)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.resolve(__dirname, '../../tools');

/**
 * Minimal YAML parser for ibr tool files.
 * Supports the specific subset used in tool definitions:
 *   - top-level scalar strings (key: value or key: "value")
 *   - top-level block sequences (key:\n  - item)
 *   - nested mapping sequences under params:
 *       params:
 *         - name: foo
 *           description: bar
 *           required: true
 *           default: baz
 *
 * @param {string} text Raw YAML text
 * @returns {object}
 */
export function parseToolYaml(text) {
  const lines = text.split('\n');
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines and comments
    if (/^\s*(#|$)/.test(line)) { i++; continue; }

    // Top-level key (no leading spaces)
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (!topMatch) { i++; continue; }

    const key = topMatch[1];
    const rest = topMatch[2].trim();
    i++;

    if (rest === '' || rest === '|' || rest === '>') {
      // Block value — collect indented lines
      const items = [];
      let isSeq = false;
      let mappingItems = null;
      let currentMapping = null;

      while (i < lines.length) {
        const child = lines[i];
        if (/^\s*(#|$)/.test(child)) { i++; continue; }

        // Must be indented
        const childIndent = child.match(/^(\s+)/)?.[1]?.length ?? 0;
        if (childIndent === 0) break;

        const seqMatch = child.match(/^\s+-\s+(.*)/);
        const mapMatch = child.match(/^\s+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);

        if (seqMatch) {
          const val = seqMatch[1].trim();
          if (!isSeq) {
            isSeq = true;
            mappingItems = [];
            currentMapping = null;
          }
          // A bare sequence item or start of a mapping sequence item
          // Check if next lines are further-indented key:value pairs
          const nextIndent = lines[i + 1]?.match(/^(\s+)/)?.[1]?.length ?? 0;
          const childItemIndent = child.match(/^(\s+)-/)?.[1]?.length ?? 0;

          if (nextIndent > childItemIndent + 1) {
            // Mapping sequence — this '-' starts a new mapping object
            currentMapping = {};
            // If the line has content after '-', parse it as key: value
            if (val) {
              const kv = val.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
              if (kv) currentMapping[kv[1]] = unquote(kv[2].trim());
            }
            mappingItems.push(currentMapping);
          } else {
            // Plain sequence item
            mappingItems.push(unquote(val));
            currentMapping = null;
          }
          i++;
        } else if (mapMatch && currentMapping !== null) {
          // Continuation of a mapping sequence item
          currentMapping[mapMatch[1]] = unquote(mapMatch[2].trim());
          i++;
        } else {
          break;
        }
      }

      result[key] = isSeq ? mappingItems : items;
    } else {
      // Inline scalar
      result[key] = unquote(rest);
    }
  }

  return result;
}

/** Strip surrounding quotes from a YAML scalar value. */
function unquote(val) {
  if (!val) return val;
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (val === 'true') return true;
  if (val === 'false') return false;
  return val;
}

/**
 * Resolve tool file path: checks absolute/relative path, then tools/ dir.
 *
 * @param {string} nameOrPath Tool name or file path
 * @returns {string} Resolved absolute path
 */
export function resolveToolPath(nameOrPath) {
  // Absolute or relative path with extension
  if (nameOrPath.includes('/') || nameOrPath.endsWith('.yaml') || nameOrPath.endsWith('.yml')) {
    return path.resolve(nameOrPath);
  }
  // Name lookup in tools/
  const candidates = [
    path.join(TOOLS_DIR, `${nameOrPath}.yaml`),
    path.join(TOOLS_DIR, `${nameOrPath}.yml`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]; // Return first candidate; caller handles missing file
}

/**
 * Parse --param flags from argv slice (after 'tool <name>').
 * Each --param must be followed by key=value.
 *
 * @param {string[]} args
 * @returns {{ params: Record<string,string>, extra: string[] }}
 */
export function parseToolArgs(args) {
  const params = {};
  const extra = [];
  let i = 0;
  while (i < args.length) {
    if (args[i] === '--param' || args[i] === '-p') {
      const kv = args[i + 1];
      if (!kv || kv.startsWith('--')) {
        throw new Error(`--param requires key=value, e.g. --param query="site:example.com"`);
      }
      const eqIdx = kv.indexOf('=');
      if (eqIdx === -1) {
        throw new Error(`--param value must be key=value (got: ${kv})`);
      }
      params[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
      i += 2;
    } else {
      extra.push(args[i]);
      i++;
    }
  }
  return { params, extra };
}

/**
 * Validate params against tool definition; apply defaults.
 *
 * @param {object[]} paramDefs  Array of param definitions from YAML
 * @param {Record<string,string>} supplied  Values from --param flags
 * @returns {Record<string,string>} Merged params with defaults applied
 */
export function resolveParams(paramDefs, supplied) {
  const resolved = { ...supplied };
  for (const def of paramDefs ?? []) {
    const { name, required, default: dflt } = def;
    if (!(name in resolved)) {
      if (required === true || required === 'true') {
        throw new Error(
          `Missing required param: ${name}. ` +
          `Pass it with --param ${name}=<value>.`
        );
      }
      if (dflt !== undefined && dflt !== null) {
        resolved[name] = String(dflt);
      }
    }
  }
  return resolved;
}

/**
 * Interpolate {{param}} placeholders in a string.
 *
 * @param {string} text
 * @param {Record<string,string>} params
 * @returns {string}
 */
export function interpolate(text, params) {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    return Object.prototype.hasOwnProperty.call(params, trimmed)
      ? params[trimmed]
      : `{{${trimmed}}}`;
  });
}

/**
 * Build an ibr prompt string from a loaded + interpolated tool definition.
 *
 * @param {object} tool  Parsed and interpolated tool object
 * @returns {string}
 */
export function buildPrompt(tool) {
  const lines = [];

  if (tool.url) {
    lines.push(`url: ${tool.url}`);
  }

  const instructions = Array.isArray(tool.instructions) ? tool.instructions : [];
  if (instructions.length > 0) {
    lines.push('instructions:');
    for (const step of instructions) {
      lines.push(`  - ${step}`);
    }
  }

  return lines.join('\n');
}

/**
 * Load a tool, interpolate params, and return the prompt string.
 *
 * @param {string} nameOrPath  Tool name or file path
 * @param {Record<string,string>} params  Param values from --param flags
 * @returns {{ prompt: string, tool: object }}
 */
export function loadAndBuildPrompt(nameOrPath, params) {
  const filePath = resolveToolPath(nameOrPath);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Tool not found: "${nameOrPath}". ` +
      `Expected file at: ${filePath}. ` +
      `Run "ibr tool --list" to see available tools.`
    );
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const tool = parseToolYaml(raw);
  const resolvedParams = resolveParams(tool.params, params);

  // Interpolate all string fields
  const interpolated = {
    ...tool,
    url: tool.url ? interpolate(tool.url, resolvedParams) : undefined,
    instructions: Array.isArray(tool.instructions)
      ? tool.instructions.map(s => interpolate(String(s), resolvedParams))
      : [],
  };

  return { prompt: buildPrompt(interpolated), tool: interpolated };
}

/**
 * List available tool names from the tools/ directory.
 *
 * @returns {string[]}
 */
export function listTools() {
  if (!fs.existsSync(TOOLS_DIR)) return [];
  return fs.readdirSync(TOOLS_DIR)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => path.basename(f, path.extname(f)))
    .sort();
}
