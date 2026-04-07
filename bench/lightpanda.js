#!/usr/bin/env node
/**
 * Lightpanda vs Chromium benchmark — measures startup, wall time,
 * and peak RSS across representative ibr flows.
 *
 * Usage:
 *   node bench/lightpanda.js [--backends lightpanda,chromium]
 *                            [--scenarios static-scrape,dom-extract]
 *                            [--iterations 5]
 *                            [--output bench/results/lightpanda-vs-chromium-v1.md]
 *
 * Requires a cached lightpanda binary; run `ibr browser pull lightpanda`
 * first OR set BROWSER_CHANNEL=lightpanda env once for any ibr command
 * to warm the cache.
 *
 * Track: adopt-lightpanda (T-0036)
 * Spec: .tlc/tracks/adopt-lightpanda/spec.md — Q1 driver: speed/footprint
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveBrowser } from '../src/browser/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ALL_BACKENDS = ['chromium', 'lightpanda'];
const ALL_SCENARIOS = ['static-scrape', 'dom-extract', 'annotate-screenshot'];
const DEFAULT_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  let backends = [...ALL_BACKENDS];
  let scenarios = [...ALL_SCENARIOS];
  let iterations = DEFAULT_ITERATIONS;
  let output = path.join(
    __dirname,
    'results',
    'lightpanda-vs-chromium-v1.md'
  );

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--backends' && args[i + 1]) {
      backends = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--scenarios' && args[i + 1]) {
      scenarios = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--iterations' && args[i + 1]) {
      iterations = parseInt(args[++i], 10);
      if (!Number.isFinite(iterations) || iterations < 1) {
        process.stderr.write('--iterations must be a positive integer\n');
        process.exit(1);
      }
    } else if (a === '--output' && args[i + 1]) {
      output = args[++i];
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: node bench/lightpanda.js ' +
          '[--backends list] [--scenarios list] ' +
          '[--iterations N] [--output path]\n'
      );
      process.exit(0);
    }
  }

  return { backends, scenarios, iterations, output };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Run fn(); capture wall time (ms) and peak RSS (bytes) of the current node
 * process during the call. Note: this is the ibr parent process — child
 * browser processes are NOT captured here. See README / results notes.
 */
async function measure(fn) {
  const startRss = process.memoryUsage().rss;
  let peakRss = startRss;
  const start = process.hrtime.bigint();
  const interval = setInterval(() => {
    const r = process.memoryUsage().rss;
    if (r > peakRss) peakRss = r;
  }, 50);
  try {
    await fn();
  } finally {
    clearInterval(interval);
  }
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { elapsedMs, peakRssBytes: peakRss };
}

// ---------------------------------------------------------------------------
// Run one scenario × backend × N iterations
// ---------------------------------------------------------------------------

async function runScenarioOnBackend(scenarioName, backend, iterations) {
  const scenarioMod = await import(
    `./lightpanda-scenarios/${scenarioName}.js`
  );

  // Setup once (server startup etc.) — outside measurement window.
  if (typeof scenarioMod.setup === 'function') {
    await scenarioMod.setup();
  }

  const env = { ...process.env };
  if (backend === 'lightpanda') {
    env.BROWSER_CHANNEL = 'lightpanda';
  } else {
    // For the "chromium" backend we want the default Playwright bundled
    // chromium (chromium-launch). Forcing BROWSER_CHANNEL=chromium would
    // route the resolver to a *system* chromium probe, which fails on
    // most dev hosts. Unsetting BROWSER_CHANNEL drops us to the default
    // chain → playwright bundled.
    delete env.BROWSER_CHANNEL;
  }

  const iters = [];
  try {
    for (let i = 0; i < iterations; i++) {
      let handle = null;
      const startupStart = Date.now();
      try {
        handle = await resolveBrowser(env);
      } catch (err) {
        iters.push({
          iteration: i,
          error: `resolveBrowser failed: ${err.message}`,
        });
        continue;
      }
      const startupMs = Date.now() - startupStart;

      try {
        const { elapsedMs, peakRssBytes } = await measure(() =>
          scenarioMod.run(handle)
        );
        iters.push({
          iteration: i,
          startupMs,
          elapsedMs,
          peakRssBytes,
        });
      } catch (err) {
        process.stderr.write(
          `[${backend}/${scenarioName}] iteration ${i} failed: ${err.message}\n`
        );
        iters.push({
          iteration: i,
          startupMs,
          error: err.message,
        });
      } finally {
        if (handle) {
          try {
            await handle.close();
          } catch {
            /* ignore */
          }
        }
      }
    }
  } finally {
    if (typeof scenarioMod.teardown === 'function') {
      try {
        await scenarioMod.teardown();
      } catch (err) {
        process.stderr.write(
          `[${backend}/${scenarioName}] teardown failed: ${err.message}\n`
        );
      }
    }
  }

  return iters;
}

// ---------------------------------------------------------------------------
// Stats + report
// ---------------------------------------------------------------------------

function avg(nums) {
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function summarize(iterations) {
  const ok = iterations.filter((r) => !r.error);
  const errors = iterations.filter((r) => r.error);
  // Drop iteration 0 when computing averages (cold start / cache warm) if
  // more than one successful iteration exists.
  const forAvg = ok.length > 1 ? ok.slice(1) : ok;
  const startups = forAvg.map((r) => r.startupMs);
  const walls = forAvg.map((r) => r.elapsedMs);
  const rsss = forAvg.map((r) => r.peakRssBytes);
  return {
    successes: ok.length,
    failures: errors.length,
    startupMs: avg(startups),
    wallMs: avg(walls),
    peakRssBytes: avg(rsss),
    errorSamples: errors.slice(0, 3).map((e) => e.error),
  };
}

function fmtMs(v) {
  if (v == null || Number.isNaN(v)) return '--';
  return v.toFixed(0);
}

function fmtMb(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '--';
  return (bytes / (1024 * 1024)).toFixed(1);
}

function renderReport({
  meta,
  iterations,
  backends,
  scenarios,
  results,
}) {
  const lines = [];
  lines.push('# Lightpanda vs Chromium benchmark — v1');
  lines.push('');
  lines.push(`**Date:** ${meta.date}`);
  lines.push('**Harness:** `bench/lightpanda.js`');
  lines.push(`**Scenarios:** ${scenarios.join(', ')}`);
  lines.push(`**Iterations per scenario × backend:** ${iterations}`);
  lines.push(`**Node:** ${meta.node}`);
  lines.push(`**Host:** ${meta.platform}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');

  // Auto-summary: which backends had any successes? Surface compat gaps.
  const backendStatus = {};
  for (const backend of backends) {
    let ok = 0;
    let err = 0;
    for (const scenario of scenarios) {
      const iters = results[`${backend}/${scenario}`] || [];
      const s = summarize(iters);
      ok += s.successes;
      err += s.failures;
    }
    backendStatus[backend] = { ok, err };
  }
  const dead = backends.filter((b) => backendStatus[b].ok === 0);
  if (dead.length === backends.length) {
    lines.push(
      'No backend produced any successful iteration. The harness is ' +
        'wired but the runtime environment could not launch any browser. ' +
        'See the error column below.'
    );
  } else if (dead.length > 0) {
    lines.push(
      `Partial run. The following backends produced zero successful ` +
        `iterations and are unpopulated below: **${dead.join(', ')}**. ` +
        `Inspect the error rows for the acquisition failure (typical ` +
        `cause: GitHub API rate limit while resolving the lightpanda ` +
        `release manifest, or no cached binary). Re-run with a ` +
        `\`GITHUB_TOKEN\` exported, or warm the cache with ` +
        `\`BROWSER_CHANNEL=lightpanda node src/index.js --help\` once.`
    );
  } else {
    lines.push(
      'Live run captured for all backends. Compare wall time and peak RSS ' +
        'between backends per scenario.'
    );
  }
  lines.push('');
  lines.push(
    'Expected directionally per upstream lightpanda claims: ~9x faster ' +
      'wall time, ~16x less peak RSS on static-scrape relative to bundled ' +
      'chromium. This validates the Q1 "speed/footprint" driver from ' +
      'the brainstorm.'
  );
  lines.push('');

  for (const scenario of scenarios) {
    lines.push(`## Scenario — ${scenario}`);
    lines.push('');
    lines.push('| Backend    | Iter | OK | Err | Startup (ms) | Wall (ms) | Peak RSS (MB) |');
    lines.push('|------------|-----:|---:|----:|-------------:|----------:|--------------:|');
    for (const backend of backends) {
      const key = `${backend}/${scenario}`;
      const iters = results[key] || [];
      if (iters.length === 0) {
        lines.push(
          `| ${backend.padEnd(10)} |   -- | -- |  -- |           -- |        -- |            -- |`
        );
        continue;
      }
      const s = summarize(iters);
      lines.push(
        `| ${backend.padEnd(10)} | ${String(iters.length).padStart(4)} | ${String(
          s.successes
        ).padStart(2)} | ${String(s.failures).padStart(3)} | ${fmtMs(
          s.startupMs
        ).padStart(12)} | ${fmtMs(s.wallMs).padStart(9)} | ${fmtMb(
          s.peakRssBytes
        ).padStart(13)} |`
      );
    }
    lines.push('');

    // Compat gap section if any errors
    const gaps = [];
    for (const backend of backends) {
      const key = `${backend}/${scenario}`;
      const iters = results[key] || [];
      const s = summarize(iters);
      if (s.failures > 0) {
        gaps.push(
          `- **${backend}**: ${s.failures}/${iters.length} failed. ` +
            `Sample errors: ${s.errorSamples.map((e) => `\`${e}\``).join('; ')}`
        );
      }
    }
    if (gaps.length > 0) {
      lines.push('**Errors:**');
      lines.push('');
      lines.push(...gaps);
      lines.push('');
    }
  }

  lines.push('## Notes');
  lines.push('');
  lines.push(
    '- Measurements are wall-clock + RSS from the **ibr process**, not the ' +
      'child browser. Lightpanda\'s footprint in particular is split between ' +
      'the ibr node process and the lightpanda Zig child; the comparison ' +
      'reported here under-counts the chromium child. For apples-to-apples ' +
      'full-family RSS, wrap the run in `/usr/bin/time -l` (macOS) or ' +
      '`/usr/bin/time -v` (linux) and compare maximum resident set.'
  );
  lines.push(
    '- Startup time includes resolver overhead (probe + cache lookup). ' +
      'First lightpanda run includes download; iteration 0 is excluded from ' +
      'averages when more than one iteration is reported.'
  );
  lines.push(
    '- Scenarios use a local HTTP server bound to 127.0.0.1 on an ' +
      'ephemeral port — no external network dependency.'
  );
  lines.push(
    '- To regenerate: `node bench/lightpanda.js --iterations 5 ' +
      '--output bench/results/lightpanda-vs-chromium-v1.md`. ' +
      'Overwrites this file.'
  );
  lines.push('');

  lines.push('## How to run');
  lines.push('');
  lines.push('```bash');
  lines.push('# 1. Warm the lightpanda cache once (downloads binary).');
  lines.push('BROWSER_CHANNEL=lightpanda node src/index.js --help >/dev/null');
  lines.push('');
  lines.push('# 2. Ensure playwright chromium is installed.');
  lines.push('npx playwright install chromium');
  lines.push('');
  lines.push('# 3. Run the benchmark.');
  lines.push(
    'node bench/lightpanda.js --iterations 5 ' +
      '--output bench/results/lightpanda-vs-chromium-v1.md'
  );
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { backends, scenarios, iterations, output } = parseArgs(process.argv);

  process.stdout.write(
    `lightpanda bench — backends=[${backends.join(',')}] ` +
      `scenarios=[${scenarios.join(',')}] iterations=${iterations}\n\n`
  );

  const results = {};
  for (const scenario of scenarios) {
    for (const backend of backends) {
      const key = `${backend}/${scenario}`;
      process.stdout.write(`[${key}] running ${iterations} iteration(s)...\n`);
      try {
        const iters = await runScenarioOnBackend(scenario, backend, iterations);
        results[key] = iters;
        const s = summarize(iters);
        process.stdout.write(
          `[${key}] ok=${s.successes} err=${s.failures} ` +
            `startup=${fmtMs(s.startupMs)}ms wall=${fmtMs(s.wallMs)}ms ` +
            `rss=${fmtMb(s.peakRssBytes)}MB\n`
        );
      } catch (err) {
        process.stderr.write(`[${key}] fatal: ${err.message}\n`);
        results[key] = [
          {
            iteration: 0,
            error: `runner fatal: ${err.message}`,
          },
        ];
      }
    }
  }

  const meta = {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };

  const report = renderReport({
    meta,
    iterations,
    backends,
    scenarios,
    results,
  });

  const outDir = path.dirname(output);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(output, report);

  process.stdout.write(`\nReport written: ${output}\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
