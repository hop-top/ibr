/**
 * Unit tests for src/commands/tool.js
 *
 * Tests: parseToolYaml, resolveParams, interpolate, buildPrompt,
 *        parseToolArgs, loadAndBuildPrompt
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseToolYaml,
  resolveParams,
  interpolate,
  buildPrompt,
  parseToolArgs,
  loadAndBuildPrompt,
  resolveToolPath,
  listTools,
} from '../../../src/commands/tool.js';

// ─── parseToolYaml ────────────────────────────────────────────────────────────

describe('parseToolYaml', () => {
  it('parses scalar string fields', () => {
    const yaml = `name: web-search\ndescription: "Search the web"`;
    const result = parseToolYaml(yaml);
    expect(result.name).toBe('web-search');
    expect(result.description).toBe('Search the web');
  });

  it('parses unquoted scalar', () => {
    const yaml = `url: https://www.google.com`;
    expect(parseToolYaml(yaml).url).toBe('https://www.google.com');
  });

  it('parses plain sequence (instructions)', () => {
    const yaml = [
      'instructions:',
      '  - click submit',
      '  - extract results',
    ].join('\n');
    const result = parseToolYaml(yaml);
    expect(result.instructions).toEqual(['click submit', 'extract results']);
  });

  it('parses mapping sequence (params)', () => {
    const yaml = [
      'params:',
      '  - name: query',
      '    description: Search query',
      '    required: true',
      '  - name: count',
      '    description: Result count',
      '    default: "5"',
    ].join('\n');
    const result = parseToolYaml(yaml);
    expect(result.params).toHaveLength(2);
    expect(result.params[0].name).toBe('query');
    expect(result.params[0].required).toBe(true);
    expect(result.params[1].name).toBe('count');
    expect(result.params[1].default).toBe('5');
  });

  it('skips blank lines and comments', () => {
    const yaml = [
      '# This is a comment',
      '',
      'name: web-search',
      '# Another comment',
      'url: https://example.com',
    ].join('\n');
    const result = parseToolYaml(yaml);
    expect(result.name).toBe('web-search');
    expect(result.url).toBe('https://example.com');
  });

  it('parses a complete tool file', () => {
    const yaml = [
      'name: web-search',
      'description: "Search the web"',
      'params:',
      '  - name: query',
      '    description: "Query string"',
      '    required: true',
      '  - name: count',
      '    description: "Number of results"',
      '    default: "5"',
      'url: "https://www.google.com"',
      'instructions:',
      '  - type {{query}} into search box',
      '  - extract top {{count}} results',
    ].join('\n');
    const result = parseToolYaml(yaml);
    expect(result.name).toBe('web-search');
    expect(result.url).toBe('https://www.google.com');
    expect(result.params).toHaveLength(2);
    expect(result.instructions).toHaveLength(2);
    expect(result.instructions[0]).toBe('type {{query}} into search box');
  });
});

// ─── interpolate ──────────────────────────────────────────────────────────────

describe('interpolate', () => {
  it('replaces {{param}} with value', () => {
    expect(interpolate('search for {{query}}', { query: 'hello world' }))
      .toBe('search for hello world');
  });

  it('replaces multiple placeholders', () => {
    expect(interpolate('{{a}} and {{b}}', { a: 'foo', b: 'bar' }))
      .toBe('foo and bar');
  });

  it('leaves unknown placeholders unchanged', () => {
    expect(interpolate('{{unknown}}', {})).toBe('{{unknown}}');
  });

  it('handles whitespace inside braces', () => {
    expect(interpolate('{{ query }}', { query: 'test' })).toBe('test');
  });

  it('replaces same placeholder multiple times', () => {
    expect(interpolate('{{x}} {{x}}', { x: 'hi' })).toBe('hi hi');
  });

  it('returns unchanged string if no placeholders', () => {
    expect(interpolate('no placeholders here', { x: 'y' }))
      .toBe('no placeholders here');
  });
});

// ─── resolveParams ────────────────────────────────────────────────────────────

describe('resolveParams', () => {
  it('passes through supplied params', () => {
    const result = resolveParams([], { query: 'foo' });
    expect(result.query).toBe('foo');
  });

  it('applies default for missing optional param', () => {
    const defs = [{ name: 'count', default: '5' }];
    const result = resolveParams(defs, {});
    expect(result.count).toBe('5');
  });

  it('supplied value overrides default', () => {
    const defs = [{ name: 'count', default: '5' }];
    const result = resolveParams(defs, { count: '10' });
    expect(result.count).toBe('10');
  });

  it('throws on missing required param', () => {
    const defs = [{ name: 'query', required: true }];
    expect(() => resolveParams(defs, {})).toThrow('Missing required param: query');
  });

  it('throws on missing required param (string "true")', () => {
    const defs = [{ name: 'query', required: 'true' }];
    expect(() => resolveParams(defs, {})).toThrow('Missing required param: query');
  });

  it('does not throw for missing optional param without default', () => {
    const defs = [{ name: 'selector', description: 'CSS selector' }];
    const result = resolveParams(defs, {});
    expect(result.selector).toBeUndefined();
  });

  it('handles null paramDefs', () => {
    const result = resolveParams(null, { foo: 'bar' });
    expect(result.foo).toBe('bar');
  });
});

// ─── buildPrompt ──────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  it('builds url + instructions block', () => {
    const tool = {
      url: 'https://example.com',
      instructions: ['click submit', 'extract result'],
    };
    const prompt = buildPrompt(tool);
    expect(prompt).toBe(
      'url: https://example.com\ninstructions:\n  - click submit\n  - extract result'
    );
  });

  it('omits url line if url is missing', () => {
    const tool = { instructions: ['step one'] };
    expect(buildPrompt(tool)).toBe('instructions:\n  - step one');
  });

  it('handles empty instructions array', () => {
    const tool = { url: 'https://example.com', instructions: [] };
    expect(buildPrompt(tool)).toBe('url: https://example.com');
  });
});

// ─── parseToolArgs ────────────────────────────────────────────────────────────

describe('parseToolArgs', () => {
  it('parses --param key=value pairs', () => {
    const { params } = parseToolArgs(['--param', 'query=hello world']);
    expect(params.query).toBe('hello world');
  });

  it('parses multiple --param flags', () => {
    const { params } = parseToolArgs(['--param', 'a=1', '--param', 'b=2']);
    expect(params).toEqual({ a: '1', b: '2' });
  });

  it('parses -p short flag', () => {
    const { params } = parseToolArgs(['-p', 'query=test']);
    expect(params.query).toBe('test');
  });

  it('collects non-flag args in extra', () => {
    const { extra } = parseToolArgs(['extra-arg']);
    expect(extra).toEqual(['extra-arg']);
  });

  it('throws if --param has no value', () => {
    expect(() => parseToolArgs(['--param'])).toThrow('--param requires key=value');
  });

  it('throws if --param value has no =', () => {
    expect(() => parseToolArgs(['--param', 'queryonly'])).toThrow('key=value');
  });

  it('allows = in value', () => {
    const { params } = parseToolArgs(['--param', 'filter=a=b']);
    expect(params.filter).toBe('a=b');
  });
});

// ─── loadAndBuildPrompt (file-system) ─────────────────────────────────────────

describe('loadAndBuildPrompt', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibr-tool-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTool(name, content) {
    const p = path.join(tmpDir, `${name}.yaml`);
    fs.writeFileSync(p, content);
    return p;
  }

  it('loads and interpolates a tool file by path', () => {
    const toolPath = writeTool('my-tool', [
      'name: my-tool',
      'url: "https://example.com/search?q={{query}}"',
      'instructions:',
      '  - search for {{query}}',
      '  - get first {{count}} results',
      'params:',
      '  - name: query',
      '    required: true',
      '  - name: count',
      '    default: "3"',
    ].join('\n'));

    const { prompt } = loadAndBuildPrompt(toolPath, { query: 'hello' });
    expect(prompt).toContain('url: https://example.com/search?q=hello');
    expect(prompt).toContain('search for hello');
    expect(prompt).toContain('get first 3 results');
  });

  it('throws if tool file not found', () => {
    expect(() => loadAndBuildPrompt('/nonexistent/path/tool.yaml', {}))
      .toThrow('Tool not found');
  });

  it('throws if required param missing', () => {
    const toolPath = writeTool('need-query', [
      'url: https://example.com',
      'params:',
      '  - name: query',
      '    required: true',
    ].join('\n'));
    expect(() => loadAndBuildPrompt(toolPath, {}))
      .toThrow('Missing required param: query');
  });
});

// ─── listTools ────────────────────────────────────────────────────────────────

describe('listTools', () => {
  it('returns sorted list of tool names from tools/ directory', () => {
    const tools = listTools();
    // At minimum web-fetch and web-search should be present
    expect(tools).toContain('web-fetch');
    expect(tools).toContain('web-search');
    expect([...tools]).toEqual([...tools].sort());
  });
});
