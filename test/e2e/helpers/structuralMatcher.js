/**
 * Structural matcher for T-0015 E2E fixture tests.
 *
 * Compares expected vs actual shapes with non-determinism tolerance:
 *   - instruction arrays: same length + same names (exact)
 *   - URLs: exact match (after {SERVER_URL} substitution)
 *   - extracted fields: key set + types match; values flagged 'needs_llm_eval'
 *
 * Returns { matches: bool, match_details: Array<MatchDetail> }
 */

/**
 * @typedef {Object} MatchDetail
 * @property {string} path
 * @property {*} expected
 * @property {*} actual
 * @property {boolean} match
 * @property {string} [note]
 */

/**
 * Compare expected vs actual parsed task description.
 * Exact structural checks: URL and instruction names must match.
 *
 * @param {Object} expected  fixture.expectedParsed (after URL substitution)
 * @param {Object} actual    result of Operations.parseTaskDescription()
 * @returns {{ matches: boolean, match_details: MatchDetail[] }}
 */
export function structuralMatchParsed(expected, actual) {
  const details = [];

  if (!actual || typeof actual !== 'object') {
    const actualType = actual === null ? 'null' : typeof actual;
    details.push({ path: 'root', expected: 'object', actual: actualType, match: false });
    return { matches: false, match_details: details };
  }

  // URL: exact match
  const actualUrl = actual.url ?? null;
  details.push({
    path: 'url',
    expected: expected.url,
    actual: actualUrl,
    match: expected.url === actualUrl,
  });

  // instructions: same length
  const eInstr = Array.isArray(expected.instructions) ? expected.instructions : [];
  const aInstr = Array.isArray(actual.instructions) ? actual.instructions : [];

  details.push({
    path: 'instructions.length',
    expected: eInstr.length,
    actual: aInstr.length,
    match: eInstr.length === aInstr.length,
  });

  // instructions: same names in order
  const len = Math.max(eInstr.length, aInstr.length);
  for (let i = 0; i < len; i++) {
    const eName = eInstr[i]?.name ?? '<missing>';
    const aName = aInstr[i]?.name ?? '<missing>';
    details.push({
      path: `instructions[${i}].name`,
      expected: eName,
      actual: aName,
      match: eName === aName,
    });
  }

  const matches = details.every(d => d.match);
  return { matches, match_details: details };
}

/**
 * Compare expected vs actual extracts array.
 *
 * Keys and types must match; values are not compared (non-deterministic).
 * If both are empty arrays, that is an exact match.
 *
 * @param {Array} expected  fixture.expectedExtracts
 * @param {Array} actual    operations.extracts after executeTask()
 * @returns {{ matches: boolean, match_type: string, structural_notes?: string,
 *             match_details: MatchDetail[] }}
 */
export function structuralMatchExtracts(expected, actual) {
  const details = [];
  const eArr = Array.isArray(expected) ? expected : [];
  const aArr = Array.isArray(actual) ? actual : [];

  // Both empty → exact match
  if (eArr.length === 0 && aArr.length === 0) {
    return {
      matches: true,
      match_type: 'exact',
      match_details: [{ path: 'extracts', expected: [], actual: [], match: true }],
    };
  }

  // Length
  details.push({
    path: 'extracts.length',
    expected: eArr.length,
    actual: aArr.length,
    match: eArr.length === aArr.length,
  });

  const len = Math.max(eArr.length, aArr.length);
  const notes = [];

  for (let i = 0; i < len; i++) {
    const eItem = eArr[i];
    const aItem = aArr[i];

    if (eItem === undefined || aItem === undefined) {
      details.push({
        path: `extracts[${i}]`,
        expected: eItem,
        actual: aItem,
        match: false,
      });
      continue;
    }

    // Compare key sets
    const eKeys = Object.keys(eItem).sort();
    const aKeys = Object.keys(aItem).sort();
    const keysMatch = JSON.stringify(eKeys) === JSON.stringify(aKeys);
    details.push({
      path: `extracts[${i}].keys`,
      expected: eKeys,
      actual: aKeys,
      match: keysMatch,
    });

    // Compare types per key; flag values as needs_llm_eval
    for (const key of eKeys) {
      const eType = typeof eItem[key];
      const aType = typeof aItem[key];
      const typeMatch = eType === aType;
      details.push({
        path: `extracts[${i}].${key}.type`,
        expected: eType,
        actual: aType,
        match: typeMatch,
      });
      notes.push(`extracts[${i}].${key} value not compared — needs_llm_eval`);
    }
  }

  const matches = details.every(d => d.match);
  return {
    matches,
    match_type: 'structural',
    structural_notes: notes.length ? notes.join('; ') : undefined,
    match_details: details,
  };
}

/**
 * Compare two numbers with 10% tolerance.
 *
 * @param {number} expected
 * @param {number} actual
 * @returns {boolean}
 */
export function numbersMatch(expected, actual) {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) / Math.abs(expected) <= 0.1;
}
