#!/usr/bin/env node
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import logger from '../utils/logger.js';
import { judgeFixtureExtraction } from '../judge/QualityJudge.js';
import { generateQualityReport, formatMarkdownReport } from '../judge/ReportGenerator.js';
import { loadAllFixtures } from '../../test/unit/fixtures/fixture-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESULTS_DIR = resolve(__dirname, '../../test/results/e2e');

const { values: args } = parseArgs({
  options: {
    'run-id': { type: 'string' },
    threshold: { type: 'string', default: '7' },
    validate: { type: 'boolean', default: false },
    'output-dir': { type: 'string' }
  },
  strict: false
});

const parsedThreshold = Number.parseFloat(args.threshold);
const threshold = Number.isFinite(parsedThreshold) ? parsedThreshold : 7;
const outputDir = args['output-dir'] ? resolve(args['output-dir']) : DEFAULT_RESULTS_DIR;

async function findLatestRunId(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const resultFiles = files.filter(f => f.endsWith('.json') && !f.includes('quality'));
  if (!resultFiles.length) return null;
  // Use timestamp from most recent file or derive from filenames
  return 'run-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function loadResultFiles(dir) {
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const jsonFiles = files.filter(f => f.endsWith('.json') && !f.includes('quality'));
  return Promise.all(
    jsonFiles.map(async f => {
      const raw = await readFile(join(dir, f), 'utf8');
      return JSON.parse(raw);
    })
  );
}

async function runJudge(fixtures, resultFiles, times = 1) {
  // Key by absolute fixtureFile path for reliable matching
  const resultMap = new Map(resultFiles.map(r => [r.fixtureFile, r]));

  const allRuns = [];
  for (let i = 0; i < times; i++) {
    const run = await Promise.all(
      fixtures.map(entry => {
        const resultFile = resultMap.get(entry.filePath) ?? null;
        return judgeFixtureExtraction(entry, resultFile, threshold);
      })
    );
    allRuns.push(run);
  }

  if (times === 1) return allRuns[0];

  // --validate: check variance across 3 runs
  const merged = allRuns[0].map((baseResult, i) => {
    const scores = allRuns.map(run => run[i].score).filter(s => s !== null);
    if (scores.length < 2) return baseResult;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / scores.length;
    if (variance > 0.5) {
      logger.warn('High score variance detected', {
        fixture: baseResult.fixtureName,
        scores,
        variance: Math.round(variance * 100) / 100
      });
    }
    const averagedScore = Math.round(mean * 10) / 10;
    const status = averagedScore >= threshold ? 'pass' : 'fail';
    return { ...baseResult, score: averagedScore, status };
  });
  return merged;
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const runId = args['run-id'] || (await findLatestRunId(outputDir)) || `run-${Date.now()}`;
  const validateMode = args.validate;

  logger.info('Starting LLM judge', { runId, threshold, outputDir, validate: validateMode });

  const [fixtures, resultFiles] = await Promise.all([
    loadAllFixtures(),
    loadResultFiles(outputDir)
  ]);

  logger.info('Loaded fixtures and results', {
    fixtures: fixtures.length,
    resultFiles: resultFiles.length
  });

  const judgeResults = await runJudge(fixtures, resultFiles, validateMode ? 3 : 1);
  const report = generateQualityReport(judgeResults, { runId, threshold });
  const markdown = formatMarkdownReport(report);

  const qualityJsonPath = join(outputDir, `${runId}-quality.json`);
  const summaryMdPath = join(outputDir, `${runId}-summary.md`);

  await Promise.all([
    writeFile(qualityJsonPath, JSON.stringify(report, null, 2)),
    writeFile(summaryMdPath, markdown)
  ]);

  logger.info('Report written', { qualityJsonPath, summaryMdPath });
  console.log(markdown);

  const { pipelinePass, meanScore, passed, failed, skipped } = report.summary;
  console.log(`\nResult: ${pipelinePass ? 'PASS' : 'FAIL'} (mean: ${meanScore}, passed: ${passed}, failed: ${failed}, skipped: ${skipped})`);

  process.exit(pipelinePass ? 0 : 1);
}

main().catch(err => {
  logger.error('judge-e2e failed', { error: err.message });
  process.exit(1);
});
