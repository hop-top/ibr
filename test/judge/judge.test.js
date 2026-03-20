import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeJudgePrompt, parseJudgeResponse, judgeFixtureExtraction } from '../../src/judge/QualityJudge.js';
import { computeSummaryStats, generateQualityReport, formatMarkdownReport } from '../../src/judge/ReportGenerator.js';

// Mock AI provider
vi.mock('../../src/ai/provider.js', () => ({
  createAIProvider: vi.fn(() => ({
    modelInstance: {},
    provider: 'openai',
    model: 'gpt-4-mini'
  })),
  generateAIResponse: vi.fn()
}));

import { generateAIResponse } from '../../src/ai/provider.js';

// Loader entry shape: { fixture, filePath, category, name }
const mockFixtureEntry = {
  filePath: '/abs/test/fixtures/extraction/product.json',
  category: 'extraction',
  name: 'product',
  fixture: {
    description: 'Extract product details',
    category: 'extraction',
    prompt: 'Extract product details from {SERVER_URL}',
    expectedExtracts: [{ name: 'Widget', price: '9.99' }],
    expectedParsed: { url: '{SERVER_URL}', instructions: [{ name: 'extract', prompt: 'product details' }] },
    instructionCoverage: ['extract']
  }
};

// Alias for backward compat in tests that use mockFixture
const mockFixture = mockFixtureEntry;

// Result file shape written by resultRecorder (fixtureFile = absolute path)
const mockResultFile = {
  fixtureFile: '/abs/test/fixtures/extraction/product.json',
  fixtureCategory: 'extraction',
  execution: { status: 'success', duration_ms: 1200 },
  extracts: { actual: { name: 'Widget', price: '$9.99' } }
};

describe('makeJudgePrompt', () => {
  it('returns system + user messages', () => {
    const msgs = makeJudgePrompt(mockFixture, { name: 'Widget', price: '$9.99' });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
  });

  it('includes expected and actual extracts in user message', () => {
    const msgs = makeJudgePrompt(mockFixture, { name: 'Widget' });
    const user = JSON.parse(msgs[1].content);
    expect(user.expectedExtracts).toEqual(mockFixture.fixture.expectedExtracts);
    expect(user.actualExtracts).toEqual({ name: 'Widget' });
  });

  it('includes instruction and context', () => {
    const msgs = makeJudgePrompt(mockFixture, {});
    const user = JSON.parse(msgs[1].content);
    expect(user.instruction).toBe(mockFixture.fixture.prompt);
    expect(user.context.category).toBe('extraction');
  });
});

describe('parseJudgeResponse', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      score: 8.5,
      reasoning: 'Minor price format difference',
      feedback: { strengths: ['name correct'], issues: ['price format'], suggestions: [] },
      accuracy: 0.9,
      missingFields: [],
      extraneousFields: []
    });
    const result = parseJudgeResponse(raw);
    expect(result.score).toBe(8.5);
    expect(result.accuracy).toBe(0.9);
    expect(result.feedback.strengths).toEqual(['name correct']);
  });

  it('extracts JSON from text with surrounding content', () => {
    const raw = `Here is my evaluation:\n{"score": 7, "reasoning": "ok", "feedback": {"strengths": [], "issues": [], "suggestions": []}, "accuracy": 0.7, "missingFields": [], "extraneousFields": []}`;
    const result = parseJudgeResponse(raw);
    expect(result.score).toBe(7);
  });

  it('throws on invalid score below 0', () => {
    const raw = JSON.stringify({ score: -1, reasoning: '', feedback: {}, accuracy: 0, missingFields: [], extraneousFields: [] });
    expect(() => parseJudgeResponse(raw)).toThrow('Invalid score');
  });

  it('throws on score above 10', () => {
    const raw = JSON.stringify({ score: 11, reasoning: '', feedback: {}, accuracy: 0, missingFields: [], extraneousFields: [] });
    expect(() => parseJudgeResponse(raw)).toThrow('Invalid score');
  });

  it('throws on non-JSON response', () => {
    expect(() => parseJudgeResponse('not json at all')).toThrow('No JSON object found');
  });

  it('normalises missing feedback arrays to empty arrays', () => {
    const raw = JSON.stringify({ score: 5, reasoning: 'partial', feedback: {}, accuracy: 0.5, missingFields: [], extraneousFields: [] });
    const result = parseJudgeResponse(raw);
    expect(result.feedback.strengths).toEqual([]);
    expect(result.feedback.issues).toEqual([]);
  });
});

describe('judgeFixtureExtraction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns skipped when expectedExtracts empty array', async () => {
    const entry = { ...mockFixture, fixture: { ...mockFixture.fixture, expectedExtracts: [] } };
    const result = await judgeFixtureExtraction(entry, mockResultFile);
    expect(result.status).toBe('skipped');
    expect(result.score).toBeNull();
  });

  it('returns skipped when expectedExtracts undefined', async () => {
    const entry = { ...mockFixture, fixture: { ...mockFixture.fixture, expectedExtracts: undefined } };
    const result = await judgeFixtureExtraction(entry, mockResultFile);
    expect(result.status).toBe('skipped');
  });

  it('returns pass when score >= threshold', async () => {
    generateAIResponse.mockResolvedValue({
      content: JSON.stringify({ score: 9, reasoning: 'great', feedback: { strengths: [], issues: [], suggestions: [] }, accuracy: 0.95, missingFields: [], extraneousFields: [] })
    });
    const result = await judgeFixtureExtraction(mockFixture, mockResultFile);
    expect(result.status).toBe('pass');
    expect(result.score).toBe(9);
  });

  it('returns fail when score < threshold', async () => {
    generateAIResponse.mockResolvedValue({
      content: JSON.stringify({ score: 4, reasoning: 'poor', feedback: { strengths: [], issues: ['wrong'], suggestions: [] }, accuracy: 0.4, missingFields: ['price'], extraneousFields: [] })
    });
    const result = await judgeFixtureExtraction(mockFixture, mockResultFile);
    expect(result.status).toBe('fail');
    expect(result.score).toBe(4);
  });

  it('returns error status on AI failure', async () => {
    generateAIResponse.mockRejectedValue(new Error('API timeout'));
    const result = await judgeFixtureExtraction(mockFixture, mockResultFile);
    expect(result.status).toBe('error');
    expect(result.score).toBeNull();
    expect(result.reasoning).toContain('API timeout');
  });

  it('includes fixture metadata in result', async () => {
    generateAIResponse.mockResolvedValue({
      content: JSON.stringify({ score: 8, reasoning: 'good', feedback: { strengths: [], issues: [], suggestions: [] }, accuracy: 0.8, missingFields: [], extraneousFields: [] })
    });
    const result = await judgeFixtureExtraction(mockFixture, mockResultFile);
    expect(result.fixtureCategory).toBe('extraction');
    expect(result.fixtureName).toBe('product');
  });
});

describe('computeSummaryStats', () => {
  const results = [
    { score: 9, status: 'pass' },
    { score: 5, status: 'fail' },
    { score: 8, status: 'pass' },
    { score: null, status: 'skipped' },
    { score: null, status: 'error' }
  ];

  it('computes mean of scored results only', () => {
    const stats = computeSummaryStats(results, 7);
    // scored = [9, 5, 8] → mean = 7.33
    expect(stats.meanScore).toBeCloseTo(7.33, 1);
  });

  it('counts skipped correctly', () => {
    const stats = computeSummaryStats(results, 7);
    expect(stats.skipped).toBe(1);
    expect(stats.scored).toBe(3);
  });

  it('counts errors from all results (not just scored)', () => {
    const stats = computeSummaryStats(results, 7);
    expect(stats.errors).toBe(1);
  });

  it('pipelinePass true when mean >= threshold', () => {
    const stats = computeSummaryStats(results, 7);
    expect(stats.pipelinePass).toBe(true);
  });

  it('pipelinePass false when mean < threshold', () => {
    const low = [{ score: 3, status: 'fail' }, { score: 4, status: 'fail' }];
    const stats = computeSummaryStats(low, 7);
    expect(stats.pipelinePass).toBe(false);
  });

  it('pipelinePass true when all fixtures skipped', () => {
    const allSkipped = [
      { score: null, status: 'skipped' },
      { score: null, status: 'skipped' }
    ];
    const stats = computeSummaryStats(allSkipped, 7);
    expect(stats.pipelinePass).toBe(true);
    expect(stats.scored).toBe(0);
  });

  it('derives pass/fail from score vs threshold (not status field)', () => {
    // status field says 'fail' but score >= threshold → should count as passed
    const staleStatus = [
      { score: 8, status: 'fail' },
      { score: 6, status: 'pass' }
    ];
    const stats = computeSummaryStats(staleStatus, 7);
    expect(stats.passed).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it('computes median correctly for even count', () => {
    const even = [{ score: 6, status: 'fail' }, { score: 8, status: 'pass' }];
    const stats = computeSummaryStats(even, 7);
    expect(stats.medianScore).toBe(7);
  });
});

describe('judgeFixtureExtraction — threshold propagation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses custom threshold for pass/fail status', async () => {
    generateAIResponse.mockResolvedValue({
      content: JSON.stringify({ score: 6, reasoning: 'ok', feedback: { strengths: [], issues: [], suggestions: [] }, accuracy: 0.6, missingFields: [], extraneousFields: [] })
    });
    // threshold=5 → score 6 should pass
    const result = await judgeFixtureExtraction(mockFixture, mockResultFile, 5);
    expect(result.status).toBe('pass');
  });

  it('fail when score below custom threshold', async () => {
    generateAIResponse.mockResolvedValue({
      content: JSON.stringify({ score: 6, reasoning: 'ok', feedback: { strengths: [], issues: [], suggestions: [] }, accuracy: 0.6, missingFields: [], extraneousFields: [] })
    });
    // threshold=8 → score 6 should fail
    const result = await judgeFixtureExtraction(mockFixture, mockResultFile, 8);
    expect(result.status).toBe('fail');
  });
});

describe('generateQualityReport — judgeModel/Provider from first non-null', () => {
  it('picks model from first non-skipped result', () => {
    const judgeResults = [
      { score: null, status: 'skipped', judgeModel: null, judgeProvider: null },
      { score: 8, status: 'pass', judgeModel: 'gpt-4', judgeProvider: 'openai' }
    ];
    const report = generateQualityReport(judgeResults, { runId: 'r', threshold: 7 });
    expect(report.judgeModel).toBe('gpt-4');
    expect(report.judgeProvider).toBe('openai');
  });

  it('returns null model when all results are skipped', () => {
    const judgeResults = [
      { score: null, status: 'skipped', judgeModel: null, judgeProvider: null }
    ];
    const report = generateQualityReport(judgeResults, { runId: 'r', threshold: 7 });
    expect(report.judgeModel).toBeNull();
    expect(report.judgeProvider).toBeNull();
  });
});

describe('generateQualityReport', () => {
  it('includes runId, summary, and results', () => {
    const judgeResults = [
      { fixtureCategory: 'extraction', fixtureName: 'a', score: 8, status: 'pass', judgeModel: 'gpt-4-mini', judgeProvider: 'openai' }
    ];
    const report = generateQualityReport(judgeResults, { runId: 'test-run', threshold: 7 });
    expect(report.runId).toBe('test-run');
    expect(report.summary.totalFixtures).toBe(1);
    expect(report.results).toHaveLength(1);
  });
});

describe('formatMarkdownReport', () => {
  it('includes pass/fail status icon', () => {
    const report = generateQualityReport(
      [{ fixtureCategory: 'cat', fixtureName: 'fix', score: 9, status: 'pass', reasoning: '', feedback: { strengths: [], issues: [], suggestions: [] }, judgeModel: 'm', judgeProvider: 'p' }],
      { runId: 'r1', threshold: 7 }
    );
    const md = formatMarkdownReport(report);
    expect(md).toContain('✅');
    expect(md).toContain('PASS');
  });

  it('lists failing fixtures section when failures exist', () => {
    const report = generateQualityReport(
      [{ fixtureCategory: 'cat', fixtureName: 'bad', score: 3, status: 'fail', reasoning: 'wrong data', feedback: { strengths: [], issues: ['missing field'], suggestions: [] }, judgeModel: 'm', judgeProvider: 'p' }],
      { runId: 'r2', threshold: 7 }
    );
    const md = formatMarkdownReport(report);
    expect(md).toContain('Failing Fixtures');
    expect(md).toContain('wrong data');
  });

  it('includes per-category breakdown', () => {
    const report = generateQualityReport(
      [{ fixtureCategory: 'extraction', fixtureName: 'p', score: 8, status: 'pass', reasoning: '', feedback: { strengths: [], issues: [], suggestions: [] }, judgeModel: 'm', judgeProvider: 'p' }],
      { runId: 'r3', threshold: 7 }
    );
    const md = formatMarkdownReport(report);
    expect(md).toContain('extraction');
  });
});
