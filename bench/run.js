#!/usr/bin/env node
/**
 * bench/run.js — ibr benchmark runner
 *
 * Usage:
 *   node bench/run.js [--count N] [--concurrency C] [--output path]
 *
 * For each URL: spawns `ibr snap <url>` subprocess, measures wall-time + maxRSS.
 * Writes results to bench/results/<timestamp>.json (or --output path).
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES } from './pages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  let count = 100;
  let concurrency = 1;
  let output = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[++i], 10);
      if (!Number.isFinite(count) || count < 1) {
        process.stderr.write('--count must be a positive integer\n');
        process.exit(1);
      }
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[++i], 10);
      if (!Number.isFinite(concurrency) || concurrency < 1) {
        process.stderr.write('--concurrency must be a positive integer\n');
        process.exit(1);
      }
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[++i];
    }
  }

  return { count, concurrency, output };
}

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Single URL benchmark: spawns `node src/index.js snap <url>`
// Returns { url, durationMs, memoryMb, exitCode, error? }
// ---------------------------------------------------------------------------

/**
 * Poll RSS of a pid using `ps`.
 * Returns kB on Linux, bytes on macOS — returns MB normalised.
 * Returns 0 on error.
 */
function sampleRssMb(pid) {
  try {
    const r = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 500,
    });
    const kb = parseInt(r.stdout.trim(), 10);
    if (Number.isFinite(kb) && kb > 0) {
      // `ps -o rss` reports kB on both macOS and Linux
      return Math.round((kb / 1024) * 10) / 10;
    }
  } catch (_) {
    // ps unavailable or pid gone
  }
  return 0;
}

function benchUrl(url, ibrBin) {
  return new Promise((resolve) => {
    const start = Date.now();
    let peakMemoryMb = 0;
    let stderr = '';
    let pollTimer = null;

    // ibr snap exits after DOM dump — no AI needed, no API key required
    const child = spawn(
      process.execPath,
      [ibrBin, 'snap', url],
      {
        env: {
          ...process.env,
          BROWSER_HEADLESS: 'true',
          // suppress log noise in bench output
          LOG_LEVEL: 'error',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    // Poll RSS every 200ms while the child runs
    pollTimer = setInterval(() => {
      if (child.pid) {
        const mb = sampleRssMb(child.pid);
        if (mb > peakMemoryMb) peakMemoryMb = mb;
      }
    }, 200);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    // Drain stdout (we don't need the DOM output)
    child.stdout.resume();

    child.on('close', (code, signal) => {
      clearInterval(pollTimer);
      const durationMs = Date.now() - start;

      // Final sample after close
      if (child.pid) {
        const mb = sampleRssMb(child.pid);
        if (mb > peakMemoryMb) peakMemoryMb = mb;
      }

      const memoryMb = peakMemoryMb;

      const result = {
        url,
        durationMs,
        memoryMb,
        exitCode: signal ? -1 : (code ?? -1),
      };

      if (code !== 0) {
        // Extract last meaningful error line from stderr
        const errLine = stderr.trim().split('\n').filter(Boolean).pop() || '';
        result.error = errLine.slice(0, 200);
      }

      resolve(result);
    });

    child.on('error', (err) => {
      clearInterval(pollTimer);
      resolve({
        url,
        durationMs: Date.now() - start,
        memoryMb: 0,
        exitCode: -1,
        error: err.message,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Concurrency pool: runs `tasks` with max `concurrency` in-flight
// ---------------------------------------------------------------------------

async function pool(tasks, concurrency, onResult) {
  const queue = [...tasks];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) {
        const result = await task();
        onResult(result);
      }
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { count, concurrency, output } = parseArgs(process.argv);

  const urls = PAGES.slice(0, count);
  if (urls.length < count) {
    process.stderr.write(
      `Warning: only ${urls.length} URLs available (requested ${count})\n`
    );
  }

  const ibrBin = path.join(ROOT, 'src', 'index.js');
  if (!fs.existsSync(ibrBin)) {
    process.stderr.write(`ibr binary not found at ${ibrBin}\n`);
    process.exit(1);
  }

  const total = urls.length;
  let done = 0;
  const results = [];

  const benchStart = Date.now();

  process.stdout.write(
    `ibr benchmark — ${total} URLs, concurrency=${concurrency}\n\n`
  );

  const tasks = urls.map((url, idx) => async () => {
    const r = await benchUrl(url, ibrBin);
    done++;
    const memStr = r.memoryMb > 0 ? `${r.memoryMb}MB` : 'n/a';
    const status = r.exitCode === 0 ? 'OK' : `ERR(${r.exitCode})`;
    process.stdout.write(
      `[${String(done).padStart(String(total).length)}/${total}] ${r.durationMs}ms ${memStr} ${status} ${url}\n`
    );
    return r;
  });

  await pool(tasks, concurrency, (r) => results.push(r));

  const totalMs = Date.now() - benchStart;

  // ---------------------------------------------------------------------------
  // Compute summary
  // ---------------------------------------------------------------------------

  const successes = results.filter((r) => r.exitCode === 0);
  const durations = successes.map((r) => r.durationMs).sort((a, b) => a - b);
  const memories = results.map((r) => r.memoryMb).filter((m) => m > 0);

  const summary = {
    totalMs,
    avgMs: durations.length
      ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
      : 0,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    peakMemoryMb: memories.length ? Math.max(...memories) : 0,
    successRate:
      total > 0 ? Math.round((successes.length / total) * 10000) / 100 : 0,
  };

  const meta = {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    count: total,
    concurrency,
  };

  const report = { meta, results, summary };

  // ---------------------------------------------------------------------------
  // Write output
  // ---------------------------------------------------------------------------

  let outPath = output;
  if (!outPath) {
    const resultsDir = path.join(__dirname, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    outPath = path.join(resultsDir, `${ts}.json`);
  }

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // ---------------------------------------------------------------------------
  // Print summary
  // ---------------------------------------------------------------------------

  process.stdout.write('\n--- Summary ---\n');
  process.stdout.write(`Total wall time : ${totalMs}ms\n`);
  process.stdout.write(`Avg (success)   : ${summary.avgMs}ms\n`);
  process.stdout.write(`p50             : ${summary.p50Ms}ms\n`);
  process.stdout.write(`p95             : ${summary.p95Ms}ms\n`);
  process.stdout.write(`Peak memory     : ${summary.peakMemoryMb > 0 ? summary.peakMemoryMb + 'MB' : 'n/a'}\n`);
  process.stdout.write(`Success rate    : ${summary.successRate}%\n`);
  process.stdout.write(`Results written : ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
