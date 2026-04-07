/**
 * Unit tests — help output must go to stdout, not stderr.
 *
 * Regression: ibr --help / ibr help / ibr -h wrote to process.stderr,
 * causing output to be invisible when stderr is suppressed (shell pane,
 * subagent invocation, piped usage).
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(__dirname, '../../src/index.js');
const NODE = process.execPath;

function runIbr(args = [], env = {}) {
  const result = spawnSync(NODE, [INDEX, ...args], {
    env: { ...process.env, ...env },
    timeout: 5000,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    code: result.status ?? 1,
  };
}

describe('ibr help — output must be on stdout', () => {
  it('ibr --help writes usage to stdout', () => {
    const { stdout } = runIbr(['--help']);
    expect(stdout).toMatch(/ibr.*Intent Browser Runtime/i);
  });

  it('ibr -h writes usage to stdout', () => {
    const { stdout } = runIbr(['-h']);
    expect(stdout).toMatch(/ibr.*Intent Browser Runtime/i);
  });

  it('ibr help writes usage to stdout', () => {
    const { stdout } = runIbr(['help']);
    expect(stdout).toMatch(/ibr.*Intent Browser Runtime/i);
  });

  it('ibr --help writes nothing to stderr', () => {
    const { stderr } = runIbr(['--help']);
    expect(stderr).toBe('');
  });

  it('ibr -h writes nothing to stderr', () => {
    const { stderr } = runIbr(['-h']);
    expect(stderr).toBe('');
  });

  it('ibr help writes nothing to stderr', () => {
    const { stderr } = runIbr(['help']);
    expect(stderr).toBe('');
  });

  it('ibr --help exits with code 0', () => {
    const { code } = runIbr(['--help']);
    expect(code).toBe(0);
  });

  it('ibr -h exits with code 0', () => {
    const { code } = runIbr(['-h']);
    expect(code).toBe(0);
  });

  it('ibr help exits with code 0', () => {
    const { code } = runIbr(['help']);
    expect(code).toBe(0);
  });
});
