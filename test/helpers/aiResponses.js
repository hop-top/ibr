/**
 * Factory functions returning canned AI response objects.
 * Shape: { content: '<json string>', usage: { promptTokens, completionTokens, totalTokens } }
 */

const DEFAULT_USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function makeResponse(data) {
  return {
    content: JSON.stringify(data),
    usage: { ...DEFAULT_USAGE },
  };
}

/**
 * Response for parseTaskDescription — { url, instructions }
 */
export function taskDescriptionResponse(url, instructions) {
  return makeResponse({ url, instructions });
}

/**
 * Response for findElements — array of element stubs by indices
 */
export function findElementsResponse(indices) {
  return makeResponse(indices.map(x => ({ x })));
}

/**
 * Response for findElements when element not found — empty array
 */
export function emptyFindResponse() {
  return { content: '[]', usage: { ...DEFAULT_USAGE } };
}

/**
 * Response for action instruction — { elements, type, value }
 */
export function actionResponse(type, value, indices = [0]) {
  return makeResponse({ elements: indices.map(x => ({ x })), type, value });
}

/**
 * Response for extraction — array of extracted items
 */
export function extractionResponse(data) {
  return makeResponse(Array.isArray(data) ? data : [data]);
}

/**
 * Usage object with all zeros (error/missing case)
 */
export function errorUsage() {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}
