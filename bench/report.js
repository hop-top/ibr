#!/usr/bin/env node
/**
 * bench/report.js — reads results JSON, prints summary table
 *
 * Usage:
 *   node bench/report.js                    # reads latest in bench/results/
 *   node bench/report.js path/to/file.json  # explicit file
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function padEnd(s, n) {
  return String(s).padEnd(n);
}

function padStart(s, n) {
  return String(s).padStart(n);
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function findLatest(dir) {
  if (!fs.existsSync(dir)) {
    process.stderr.write(`No results directory found at ${dir}\n`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    process.stderr.write('No result files found in ' + dir + '\n');
    process.exit(1);
  }
  return path.join(dir, files[0]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const arg = process.argv[2];
  const resultsDir = path.join(__dirname, 'results');

  const filePath = arg
    ? path.resolve(arg)
    : findLatest(resultsDir);

  if (!fs.existsSync(filePath)) {
    process.stderr.write(`File not found: ${filePath}\n`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  let report;
  try {
    report = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`Invalid JSON in ${filePath}: ${e.message}\n`);
    process.exit(1);
  }

  const { meta, results, summary } = report;

  // Header
  process.stdout.write('\n=== ibr Benchmark Report ===\n');
  process.stdout.write(`File       : ${filePath}\n`);
  process.stdout.write(`Date       : ${meta.date}\n`);
  process.stdout.write(`Node       : ${meta.node}\n`);
  process.stdout.write(`Platform   : ${meta.platform}\n`);
  process.stdout.write(`Count      : ${meta.count}\n`);
  process.stdout.write(`Concurrency: ${meta.concurrency}\n\n`);

  // Table
  const URL_W = 60;
  const DUR_W = 10;
  const MEM_W = 10;
  const ST_W = 8;

  const sep = '-'.repeat(URL_W + DUR_W + MEM_W + ST_W + 7);

  process.stdout.write(
    `${padEnd('URL', URL_W)} | ${padStart('DurMs', DUR_W)} | ${padStart('MemMB', MEM_W)} | ${padEnd('Status', ST_W)}\n`
  );
  process.stdout.write(sep + '\n');

  for (const r of results) {
    const url = truncate(r.url, URL_W);
    const dur = padStart(r.durationMs, DUR_W);
    const mem = padStart(r.memoryMb > 0 ? r.memoryMb : '-', MEM_W);
    const status =
      r.exitCode === 0
        ? padEnd('OK', ST_W)
        : padEnd(`ERR(${r.exitCode})`, ST_W);
    process.stdout.write(`${padEnd(url, URL_W)} | ${dur} | ${mem} | ${status}\n`);
    if (r.error) {
      process.stdout.write(`  error: ${truncate(r.error, URL_W + DUR_W + MEM_W + ST_W)}\n`);
    }
  }

  process.stdout.write(sep + '\n\n');

  // Summary
  process.stdout.write('--- Summary ---\n');
  process.stdout.write(`Total wall time : ${summary.totalMs}ms\n`);
  process.stdout.write(`Avg (success)   : ${summary.avgMs}ms\n`);
  process.stdout.write(`p50             : ${summary.p50Ms}ms\n`);
  process.stdout.write(`p95             : ${summary.p95Ms}ms\n`);
  process.stdout.write(`Peak memory     : ${summary.peakMemoryMb > 0 ? summary.peakMemoryMb + 'MB' : 'n/a'}\n`);
  process.stdout.write(`Success rate    : ${summary.successRate}%\n\n`);
}

main();
