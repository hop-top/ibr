/**
 * Structural matcher for E2E fixture assertions (T-0015).
 *
 * Compares expected vs actual shapes — not exact values.
 * Value differences are recorded in match_details for T-0016 LLM judge.
 *
 * Rules:
 *   - URLs: exact match
 *   - instructions[]: same length + same names (exact); nested recursed
 *   - extracted fields: keys + types match; values flagged 'needs_llm_eval'
 *   - numbers: 10% tolerance
 *   - Structural mismatches → matches: false + match_details entry
 */

const NUMBER_TOLERANCE = 0.10;

/**
 * Match two parsed task descriptions structurally.
 *
 * @param {Object} expected - fixture.expectedParsed (with {SERVER_URL} already substituted)
 * @param {Object} actual   - result of Operations.parseTaskDescription()
 * @returns {{ matches: boolean, match_details: Array }}
 */
export function matchParsed(expected, actual) {
  const details = [];

  if (!actual || typeof actual !== 'object') {
    details.push({ path: 'root', expected: 'object', actual: typeof actual, match: false });
    return { matches: false, match_details: details };
  }

  // URL: exact
  matchExact('url', expected.url, actual.url, details);

  // instructions array
  matchInstructionArray('instructions', expected.instructions ?? [], actual.instructions ?? [], details);

  return {
    matches: details.every(d => d.match),
    match_details: details,
  };
}

/**
 * Match extract results structurally.
 *
 * expected: array from fixture.expectedExtracts
 * actual:   operations.extracts (array of any values)
 *
 * @param {Array} expected
 * @param {Array} actual
 * @returns {{ matches: boolean, match_type: string, structural_notes: string, match_details: Array }}
 */
export function matchExtracts(expected, actual) {
  const details = [];
  const actualArr = Array.isArray(actual) ? actual : [];
  const expectedArr = Array.isArray(expected) ? expected : [];

  // Empty expected → structural match (nothing to assert)
  if (expectedArr.length === 0) {
    return {
      matches: true,
      match_type: 'structural',
      structural_notes: 'No expected extracts defined; skipping value assertion',
      match_details: [],
    };
  }

  // Length check
  if (expectedArr.length !== actualArr.length) {
    details.push({
      path: 'extracts.length',
      expected: expectedArr.length,
      actual: actualArr.length,
      match: false,
    });
    return {
      matches: false,
      match_type: 'structural',
      structural_notes: 'Extract array length mismatch',
      match_details: details,
    };
  }

  // Per-item shape matching
  for (let i = 0; i < expectedArr.length; i++) {
    matchShape(`extracts[${i}]`, expectedArr[i], actualArr[i], details);
  }

  const matches = details.every(d => d.match !== false);
  return {
    matches,
    match_type: 'structural',
    structural_notes: matches ? '' : 'Type/key mismatch in extract results',
    match_details: details,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Exact string/value match.
 */
function matchExact(path, expected, actual, details) {
  const match = expected === actual;
  details.push({ path, expected, actual, match });
}

/**
 * Recursively match an instruction array.
 */
function matchInstructionArray(path, expected, actual, details) {
  if (expected.length !== actual.length) {
    details.push({
      path: `${path}.length`,
      expected: expected.length,
      actual: actual.length,
      match: false,
    });
    return;
  }

  for (let i = 0; i < expected.length; i++) {
    const expInstr = expected[i];
    const actInstr = actual[i] ?? {};
    const prefix = `${path}[${i}]`;

    // name: exact match
    matchExact(`${prefix}.name`, expInstr.name, actInstr.name, details);

    // prompt: when expected has it (loop/condition may omit)
    if (expInstr.prompt !== undefined) {
      const pMatch = typeof actInstr.prompt === 'string' && actInstr.prompt.length > 0;
      details.push({
        path: `${prefix}.prompt`,
        expected: 'non-empty string',
        actual: actInstr.prompt,
        match: pMatch,
        note: pMatch ? undefined : 'missing or empty prompt',
      });
    }

    // Nested instructions for loop
    if (expInstr.name === 'loop' && Array.isArray(expInstr.instructions)) {
      const actNested = Array.isArray(actInstr.instructions) ? actInstr.instructions : [];
      matchInstructionArray(`${prefix}.instructions`, expInstr.instructions, actNested, details);
    }

    // Condition branches
    if (expInstr.name === 'condition') {
      if (Array.isArray(expInstr.success_instructions)) {
        const actSuccess = Array.isArray(actInstr.success_instructions) ? actInstr.success_instructions : [];
        matchInstructionArray(`${prefix}.success_instructions`, expInstr.success_instructions, actSuccess, details);
      }
      if (Array.isArray(expInstr.failure_instructions)) {
        const actFail = Array.isArray(actInstr.failure_instructions) ? actInstr.failure_instructions : [];
        matchInstructionArray(`${prefix}.failure_instructions`, expInstr.failure_instructions, actFail, details);
      }
    }
  }
}

/**
 * Match shape of two values (keys + types).
 * Values themselves are flagged 'needs_llm_eval', not asserted.
 */
function matchShape(path, expected, actual, details) {
  const expType = getType(expected);
  const actType = getType(actual);

  if (expType !== actType) {
    details.push({ path, expected: expType, actual: actType, match: false });
    return;
  }

  if (expType === 'object') {
    const expKeys = Object.keys(expected).sort();
    const actKeys = Object.keys(actual ?? {}).sort();

    if (expKeys.join(',') !== actKeys.join(',')) {
      details.push({
        path: `${path}[keys]`,
        expected: expKeys,
        actual: actKeys,
        match: false,
      });
      return;
    }

    for (const key of expKeys) {
      matchShape(`${path}.${key}`, expected[key], actual[key], details);
    }
    return;
  }

  if (expType === 'array') {
    if (expected.length !== actual.length) {
      details.push({ path: `${path}.length`, expected: expected.length, actual: actual.length, match: false });
      return;
    }
    for (let i = 0; i < expected.length; i++) {
      matchShape(`${path}[${i}]`, expected[i], actual[i], details);
    }
    return;
  }

  if (expType === 'number') {
    const tolerance = Math.abs(expected) * NUMBER_TOLERANCE;
    const numMatch = Math.abs((actual ?? 0) - expected) <= tolerance;
    details.push({
      path,
      expected,
      actual,
      match: numMatch,
      note: numMatch ? undefined : `outside 10% tolerance`,
    });
    return;
  }

  // Scalar strings/booleans: flag for LLM eval
  details.push({
    path,
    expected,
    actual,
    match: true, // structural match — value deferred to T-0016
    note: 'needs_llm_eval',
  });
}

/**
 * Return a simplified type label.
 */
function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
