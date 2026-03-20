export function computeSummaryStats(results, threshold = 7) {
  const scored = results.filter(r => r.score !== null);
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;
  const passed = scored.filter(r => r.score >= threshold).length;
  const failed = scored.filter(r => r.score < threshold).length;

  const scores = scored.map(r => r.score);
  const meanScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const sorted = [...scores].sort((a, b) => a - b);
  const medianScore = sorted.length
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : null;

  const stdDev = meanScore !== null && scores.length > 1
    ? Math.sqrt(scores.reduce((sum, s) => sum + Math.pow(s - meanScore, 2), 0) / scores.length)
    : null;

  return {
    totalFixtures: results.length,
    scored: scored.length,
    skipped,
    passed,
    failed,
    errors,
    meanScore: meanScore !== null ? Math.round(meanScore * 100) / 100 : null,
    medianScore: medianScore !== null ? Math.round(medianScore * 100) / 100 : null,
    stdDev: stdDev !== null ? Math.round(stdDev * 100) / 100 : null,
    threshold,
    pipelinePass: scored.length === 0 ? true : meanScore >= threshold
  };
}

export function generateQualityReport(judgeResults, options = {}) {
  const { runId = 'unknown', threshold = 7 } = options;
  const summary = computeSummaryStats(judgeResults, threshold);

  let judgeModel = null;
  let judgeProvider = null;
  for (const r of judgeResults) {
    if (judgeModel == null && r?.judgeModel != null) judgeModel = r.judgeModel;
    if (judgeProvider == null && r?.judgeProvider != null) judgeProvider = r.judgeProvider;
    if (judgeModel !== null && judgeProvider !== null) break;
  }

  return {
    runId,
    judgeModel,
    judgeProvider,
    executedAt: new Date().toISOString(),
    results: judgeResults,
    summary
  };
}

export function formatMarkdownReport(report) {
  const { summary, results, runId, executedAt } = report;
  const statusIcon = summary.pipelinePass ? '✅' : '❌';

  const lines = [
    `# Extraction Quality Report`,
    ``,
    `**Run:** ${runId}  `,
    `**Date:** ${executedAt}  `,
    `**Pipeline:** ${statusIcon} ${summary.pipelinePass ? 'PASS' : 'FAIL'}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total fixtures | ${summary.totalFixtures} |`,
    `| Scored | ${summary.scored} |`,
    `| Skipped | ${summary.skipped} |`,
    `| Passed (≥${summary.threshold}) | ${summary.passed} |`,
    `| Failed | ${summary.failed} |`,
    `| Mean score | ${summary.meanScore ?? 'N/A'} |`,
    `| Median score | ${summary.medianScore ?? 'N/A'} |`,
    `| Std dev | ${summary.stdDev ?? 'N/A'} |`,
    ``
  ];

  // Per-category breakdown
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.fixtureCategory]) byCategory[r.fixtureCategory] = [];
    byCategory[r.fixtureCategory].push(r);
  }

  lines.push(`## Per-Category Breakdown`, ``);
  for (const [cat, items] of Object.entries(byCategory)) {
    const catScored = items.filter(r => r.score !== null);
    const catMean = catScored.length
      ? Math.round(catScored.reduce((s, r) => s + r.score, 0) / catScored.length * 100) / 100
      : 'N/A';
    lines.push(`### ${cat}`, ``);
    lines.push(`| Fixture | Score | Status |`);
    lines.push(`|---------|-------|--------|`);
    for (const r of items) {
      lines.push(`| ${r.fixtureName} | ${r.score ?? 'N/A'} | ${r.status} |`);
    }
    lines.push(``, `**Category mean:** ${catMean}`, ``);
  }

  // Failing fixtures
  const failing = results.filter(r => r.status === 'fail' || r.status === 'error');
  if (failing.length > 0) {
    lines.push(`## Failing Fixtures`, ``);
    for (const r of failing) {
      lines.push(`### ${r.fixtureCategory}/${r.fixtureName} (score: ${r.score ?? 'error'})`, ``);
      lines.push(`> ${r.reasoning}`, ``);
      if (r.feedback?.issues?.length) {
        lines.push(`**Issues:**`);
        for (const issue of r.feedback.issues) lines.push(`- ${issue}`);
        lines.push(``);
      }
    }
  }

  return lines.join('\n');
}
