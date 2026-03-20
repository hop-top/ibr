// ── Shared ─────────────────────────────────────────────────────────────────

function makeTaskDescriptionMessage(userPrompt) {
  const systemPrompt = `You are a parser. Your task is to read a human-written text that includes:

    A single URL (this is the target of the instructions).

    A list of instructions (can be in paragraph or list form) that describe interactions with the page at the URL.

Your goal is to return a JSON object with the following structure:

{
"url": "", // the URL mentioned in the input text
"instructions": [] // a list of structured instruction objects, described below
}

Each instruction object in the "instructions" array must follow one of these formats, depending on its type:

    Loop/repeat:
    {
    "name": "loop",
    "prompt": "what condition to check",
    "instructions": [ /* nested instruction objects */ ]
    }

    Conditional:
    {
    "name": "condition",
    "prompt": "what condition to check",
    "success_instructions": [ /* instructions if condition is true / ],
    "failure_instructions": [ / instructions if condition is false */ ]
    }

    Extract/get:
    {
    "name": "extract",
    "prompt": "what to extract from the page"
    }

    Click/fill/type/press/scroll:
    {
    "name": "click" | "fill" | "type" | "press" | "scroll",
    "prompt": "what element or action to interact with"
    }

Guidelines:

    Identify and extract the URL exactly as written.

    Parse all instructions into the appropriate JSON format, including nested structures for loops and conditionals.

    Do not include any other output, formatting, or markdown ticks.

    Return the result as a raw JSON object, valid and complete.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

// ── ARIA mode prompts ───────────────────────────────────────────────────────

function makeFindInstructionMessage(userPrompt, pageContext) {
  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to find in the page.

You will be given:
1. An instruction describing elements to find
2. An ARIA snapshot of the page — a hierarchical accessibility tree showing roles, names, and labels

Return ONLY a valid JSON array of element descriptors that match the instruction. Each descriptor must have:
  - "role": ARIA role (e.g. "button", "link", "textbox", "checkbox")
  - "name": accessible name or label of the element

Example: [{"role": "button", "name": "Sign in"}, {"role": "link", "name": "Learn more"}]

If nothing matches, return an empty array: []
Do not include any other text, explanation, or markdown formatting. Return ONLY the JSON array.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User Instructions: ${userPrompt}\nARIA Snapshot:\n${pageContext}` }
  ];
}

function makeActionInstructionMessage(userPrompt, pageContext) {
  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to act on in the page.

You will be given:
1. An instruction describing the action to perform
2. An ARIA snapshot of the page — a hierarchical accessibility tree showing roles, names, and labels

Return ONLY a valid JSON object with the following properties:
1. elements: array of element descriptors that match the instruction. Each must have:
   - "role": ARIA role (e.g. "button", "link", "textbox")
   - "name": accessible name or label of the element
   If no match, return an empty array.
2. type: action to perform — "click", "fill", "type", "press", or "scroll"
3. value: value to fill, type, or press (omit if not applicable)

Example: {"elements": [{"role": "textbox", "name": "Email"}], "type": "fill", "value": "user@example.com"}

Do not include any other text, explanation, or markdown formatting. Return ONLY the JSON object.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Instructions: ${userPrompt}\nARIA Snapshot:\n${pageContext}` }
  ];
}

function makeExtractInstructionMessage(userPrompt, pageContext) {
  const systemPrompt = `You are a JSON extraction tool. Your ONLY task is to extract data and return valid JSON.

CRITICAL RULES:
- Return ONLY a JSON array (starting with [ and ending with ])
- Do NOT include any text before or after the JSON
- Do NOT use markdown code blocks or backticks
- Do NOT include explanations, headers, or titles
- Extract exactly what the user asks for
- If nothing found, return empty array: []

You will be given:
1. An extraction instruction
2. An ARIA snapshot of the page — a hierarchical accessibility tree showing roles, names, and text

Extract the exact text with all symbols and line breaks preserved.
Return valid JSON array ONLY. Nothing else.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Extract: ${userPrompt}\nFrom ARIA Snapshot:\n${pageContext}` }
  ];
}

// ── DOM mode prompts (DomSimplifier / XPath) ───────────────────────────────

const PSEUDO_BUTTON_GUIDANCE = `
The snapshot may include two sections:
1. Standard DOM elements with numeric x refs
2. Pseudo-interactive elements with @c refs (divs/spans with cursor:pointer or onclick)
Prefer numeric x refs; use @c refs only for custom interactive components not reachable by index.`;

function makeFindInstructionMessageDom(userPrompt, pageContext) {
  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to find in the page.

You will be given:
1. An instruction describing elements to find
2. A simplified DOM tree where each interactive element is labelled with an index x

Return ONLY a valid JSON array of element descriptors that match the instruction. Each descriptor must have:
  - "x": the element reference — either an integer index (standard DOM) or a string like "c1" (pseudo-button, without leading @)

Example: [{"x": 3}, {"x": 17}]
Pseudo-button example: [{"x": "c1"}]

If nothing matches, return an empty array: []
Do not include any other text, explanation, or markdown formatting. Return ONLY the JSON array.
${PSEUDO_BUTTON_GUIDANCE}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User Instructions: ${userPrompt}\nDOM Tree:\n${pageContext}` }
  ];
}

function makeActionInstructionMessageDom(userPrompt, pageContext) {
  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to act on in the page.

You will be given:
1. An instruction describing the action to perform
2. A simplified DOM tree where each interactive element is labelled with an index x

Return ONLY a valid JSON object with the following properties:
1. elements: array of element descriptors. Each must have:
   - "x": the element reference — either an integer index (standard DOM) or a string like "c1" (pseudo-button, without leading @)
   If no match, return an empty array.
2. type: action to perform — "click", "fill", "type", "press", or "scroll"
3. value: value to fill, type, or press (omit if not applicable)

Example: {"elements": [{"x": 5}], "type": "fill", "value": "user@example.com"}

Do not include any other text, explanation, or markdown formatting. Return ONLY the JSON object.
${PSEUDO_BUTTON_GUIDANCE}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Instructions: ${userPrompt}\nDOM Tree:\n${pageContext}` }
  ];
}

function makeExtractInstructionMessageDom(userPrompt, pageContext) {
  const systemPrompt = `You are a JSON extraction tool. Your ONLY task is to extract data and return valid JSON.

CRITICAL RULES:
- Return ONLY a JSON array (starting with [ and ending with ])
- Do NOT include any text before or after the JSON
- Do NOT use markdown code blocks or backticks
- Do NOT include explanations, headers, or titles
- Extract exactly what the user asks for
- If nothing found, return empty array: []

You will be given:
1. An extraction instruction
2. A simplified DOM tree showing text content and element structure

Extract the exact text with all symbols and line breaks preserved.
Return valid JSON array ONLY. Nothing else.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Extract: ${userPrompt}\nFrom DOM Tree:\n${pageContext}` }
  ];
}

/**
 * Build a find-instruction message using a DOM diff instead of the full tree.
 * Falls back to makeFindInstructionMessageDom when diff is null/unavailable.
 *
 * @param {string} userPrompt
 * @param {Object|null} diff - result of SnapshotDiffer.computeDiff()
 * @param {string} fullDomTree - stringified full DOM (used as fallback context)
 * @returns {Array<{role:string, content:string}>}
 */
function makeFindInstructionWithDiffMessage(userPrompt, diff, fullDomTree) {
  if (!diff) {
    return makeFindInstructionMessage(userPrompt, fullDomTree);
  }

  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to find in the page.

Scope your search to what recently changed on the page. You will be given:
1. An instruction of elements to find
2. A JSON diff showing only what changed: added nodes, removed nodes, and modified nodes
   - added: new nodes (with x index, n tag, a attrs, t text, path)
   - removed: deleted nodes (with x index, path)
   - modified: nodes whose text or ARIA attributes changed (with x index, changes)

You MUST return ONLY a valid JSON array of elements that match the instruction if they exist,
otherwise return an empty array. Do not include any other text, explanation, or markdown formatting.
Return ONLY the JSON array.`;

  const diffJson = JSON.stringify(diff, null, 0);

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User Instructions: ${userPrompt}\nDiff: ${diffJson}` }
  ];
}

export {
  makeTaskDescriptionMessage,
  // aria mode
  makeFindInstructionMessage,
  makeActionInstructionMessage,
  makeExtractInstructionMessage,
  // dom mode
  makeFindInstructionMessageDom,
  makeActionInstructionMessageDom,
  makeExtractInstructionMessageDom,
  // diff mode
  makeFindInstructionWithDiffMessage,
};
