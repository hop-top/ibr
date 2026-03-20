import { createAIProvider, generateAIResponse } from '../ai/provider.js';
import logger from '../utils/logger.js';

const JUDGE_SYSTEM_PROMPT = `You are an extraction quality evaluator. Score how well actual extracted data
matches expected data on a 0-10 scale.

Scoring rubric:
- 10: Exact match, all fields correct
- 8-9: Minor formatting/whitespace differences, 1-2 fields missing
- 6-7: Significant omissions (>2 fields), some wrong values
- 4-5: 30-50% accurate
- 1-3: Mostly wrong
- 0: Fatal error or no output

Respond ONLY with valid JSON matching this schema exactly:
{
  "score": <number 0-10>,
  "reasoning": "<explanation>",
  "feedback": {
    "strengths": ["<strength>"],
    "issues": ["<issue>"],
    "suggestions": ["<suggestion>"]
  },
  "accuracy": <number 0-1>,
  "missingFields": ["<field>"],
  "extraneousFields": ["<field>"]
}`;

export function makeJudgePrompt(entry, actualExtracts) {
  const system = JUDGE_SYSTEM_PROMPT;
  const user = JSON.stringify({
    expectedExtracts: entry.fixture.expectedExtracts,
    actualExtracts,
    instruction: entry.fixture.prompt,
    context: { category: entry.category, name: entry.name }
  }, null, 2);
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

export function parseJudgeResponse(raw) {
  let parsed;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response');
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`Failed to parse judge response: ${err.message}`);
  }

  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error(`Invalid score: ${parsed.score} (must be 0-10)`);
  }

  return {
    score: Math.round(score * 10) / 10,
    reasoning: String(parsed.reasoning || ''),
    feedback: {
      strengths: Array.isArray(parsed.feedback?.strengths) ? parsed.feedback.strengths : [],
      issues: Array.isArray(parsed.feedback?.issues) ? parsed.feedback.issues : [],
      suggestions: Array.isArray(parsed.feedback?.suggestions) ? parsed.feedback.suggestions : []
    },
    accuracy: Math.min(1, Math.max(0, Number(parsed.accuracy) || 0)),
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
    extraneousFields: Array.isArray(parsed.extraneousFields) ? parsed.extraneousFields : []
  };
}

export async function judgeFixtureExtraction(entry, resultFile, threshold = 7) {
  const start = Date.now();

  const expectedExtracts = Array.isArray(entry.fixture?.expectedExtracts)
    ? entry.fixture.expectedExtracts
    : null;

  if (!expectedExtracts || expectedExtracts.length === 0) {
    logger.warn('Skipping fixture — no expectedExtracts', { fixture: entry.name });
    return {
      fixtureFile: entry.filePath,
      fixtureCategory: entry.category,
      fixtureName: entry.name,
      score: null,
      status: 'skipped',
      reasoning: 'No expectedExtracts defined',
      feedback: { strengths: [], issues: [], suggestions: [] },
      accuracy: null,
      missingFields: [],
      extraneousFields: [],
      executionMs: 0,
      judgeMs: 0
    };
  }

  const actualExtracts = resultFile?.extracts?.actual ?? null;

  try {
    const { modelInstance, provider, model } = createAIProvider();
    const messages = makeJudgePrompt(entry, actualExtracts);
    const response = await generateAIResponse(modelInstance, messages, { temperature: 0 });
    const judgeResult = parseJudgeResponse(response.content);
    const judgeMs = Date.now() - start;

    return {
      fixtureFile: entry.filePath,
      fixtureCategory: entry.category,
      fixtureName: entry.name,
      score: judgeResult.score,
      status: judgeResult.score >= threshold ? 'pass' : 'fail',
      reasoning: judgeResult.reasoning,
      feedback: judgeResult.feedback,
      accuracy: judgeResult.accuracy,
      missingFields: judgeResult.missingFields,
      extraneousFields: judgeResult.extraneousFields,
      executionMs: resultFile?.execution?.duration_ms ?? 0,
      judgeMs,
      judgeModel: model,
      judgeProvider: provider
    };
  } catch (err) {
    logger.error('Judge failed for fixture', { fixture: entry.name, error: err.message });
    return {
      fixtureFile: entry.filePath,
      fixtureCategory: entry.category,
      fixtureName: entry.name,
      score: null,
      status: 'error',
      reasoning: err.message,
      feedback: { strengths: [], issues: [], suggestions: [] },
      accuracy: null,
      missingFields: [],
      extraneousFields: [],
      executionMs: resultFile?.execution?.duration_ms ?? 0,
      judgeMs: Date.now() - start
    };
  }
}
