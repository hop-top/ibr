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

    Wait for human intervention:
    {
    "name": "wait_for_human",
    "prompt": "reason for waiting (e.g. 'solve the captcha')"
    }

    Wait for duration:
    {
    "name": "wait",
    "prompt": "duration in seconds (e.g. '5')"
    }

Choosing between "wait" and "wait_for_human":

    Use "wait" whenever the instruction waits for the page, an element, content, or a condition to load, appear, render, or finish — e.g. "wait for the page to load", "wait for the login form to load", "wait until the results appear" — or waits for an amount of time. If no duration is given, use a short default such as "5".

    Use "wait_for_human" ONLY when the instruction explicitly asks a human to intervene or provide input — e.g. "wait for me to log in", "ask me before continuing", "pause for user input", "let me solve the captcha". Waiting for the page or its content to load is NEVER "wait_for_human".

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

// A verdict/report-style extract asks the model to REPORT a status token
// ("report PAGE_OK if the heading is shown, or PAGE_FAILED with the error"),
// not to scrape page data. The generic extraction framing ("extract data from
// the page; return [] if nothing found") makes the model emit literal [] for
// such instructions, because a verdict is not page-data — so the verdict token
// the user asked for is lost at the source, before any parser can recover it.
//
// This block, appended only when verdict intent is detected, tells the model to
// emit the verdict token as a one-record data payload. It leaves ordinary
// data-extraction untouched (the block is absent for non-verdict prompts).
const VERDICT_EXTRACT_GUIDANCE = `

VERDICT / REPORT MODE (this instruction asks you to REPORT a status token, not to scrape page data):
- Evaluate the condition described in the instruction against the snapshot.
- Return a JSON array containing ONE object whose "verdict" field is the exact token the instruction told you to report (e.g. {"verdict":"PAGE_OK"}).
- Pick the token that matches the page state (e.g. the success token if the described element/state is present, the failure token otherwise).
- If the instruction says to include error text or other detail with a token, add it as extra fields on that same object (e.g. {"verdict":"PAGE_FAILED","error":"..."}).
- A verdict is NOT page-data, so do NOT return an empty array here — always emit the object with the chosen verdict token.`;

// An UPPER_SNAKE / UPPERCASE status token (PAGE_OK, LOGIN_FAILED, OK, FAILED).
// Case-SENSITIVE on purpose: lowercase "ok"/"error"/"status" are ordinary words,
// not verdict tokens.
const STATUS_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b(?:OK|FAIL|FAILED|PASS|PASSED|SUCCESS|ERROR|TRUE|FALSE|YES|NO)\b/;

// The ENTIRE prompt is a single uppercase status token — the shape a
// condition-split leaves on its success/failure path ("PAGE_OK", "LOGIN_FAILED",
// "FAILED"). Anchored so it never matches a token merely embedded in a sentence.
const BARE_STATUS_TOKEN = /^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|OK|FAIL|FAILED|PASS|PASSED|SUCCESS|ERROR|TRUE|FALSE|YES|NO)$/;

// A bare UPPER_SNAKE token and a bare data-FIELD name are lexically identical
// ("PAGE_OK" vs "ORDER_ID"), so BARE_STATUS_TOKEN alone cannot tell a verdict
// from a field. There is no reliable positive verdict allowlist (verdict tokens
// are open-ended — a user may invent PAGE_XYZ). But every verdict token in this
// codebase is an OUTCOME word (…_OK / …_FAILED / …_ERROR / …_GREEN / NOT_FOUND /
// the enumerated short tokens), while data fields end in an identifier/field
// suffix. A bare token whose FINAL segment is one of these suffixes is a data
// field to scrape, not a verdict to emit — exclude it from the bare-token branch
// so it routes to ordinary extraction. Anchored on the last segment only.
const IDENTIFIER_FIELD_SUFFIX = /_(?:ID|SKU|CODE|NAME|URL|KEY|PATH)$/;

// Detect verdict/report-style extract intent from the raw instruction text.
// General over arbitrary tokens (PAGE_OK / LOGIN_FAILED / STATUS_GREEN / …):
// a reporting verb (report/return/respond/output/emit/say/print) combined with a
// REAL verdict signal — an UPPER_SNAKE / uppercase status token, or an explicit
// either/or ("X or Y") report shape between two such tokens.
//
// The lowercase words "status"/"verdict" ALONE must NOT trigger: they appear as
// ordinary nouns in legitimate multi-row data extractions ("return the order
// status for each row", "report the current status of each shipment"), which
// would otherwise be misrouted into single-token verdict mode and lose the list.
function isVerdictExtractPrompt(userPrompt) {
  if (!userPrompt || typeof userPrompt !== 'string') return false;
  const text = userPrompt.trim();
  // Condition-split: the parser sometimes turns "report PAGE_OK if <cond>, or
  // PAGE_FAILED …" into a condition instruction plus a BARE extract whose prompt
  // is just the token ("PAGE_OK") on the success path (the failure token on the
  // failure path). That child carries no report verb, but a prompt that IS
  // nothing but an uppercase status token is unambiguously a verdict to emit —
  // recognise it directly so the verdict lands regardless of how the LLM split.
  // Exclude bare identifier/field-suffix tokens (ORDER_ID, PRODUCT_SKU, …): those
  // name a data field to scrape, not a status to report, and no real verdict
  // token in this codebase uses those suffixes.
  if (BARE_STATUS_TOKEN.test(text)) return !IDENTIFIER_FIELD_SUFFIX.test(text);
  const reportVerb = /\b(report|respond with|return|reply with|output|emit|say|print)\b/i;
  if (!reportVerb.test(text)) return false;
  // A real UPPER_SNAKE / enumerated-keyword status token (PAGE_OK, LOGIN_FAILED,
  // OK, FAILED, …) is an unambiguous verdict signal on its own — accept it
  // regardless of surrounding enumeration phrasing.
  if (STATUS_TOKEN.test(text)) return true;
  // An explicit "X or Y" report shape between two uppercase tokens — covers short
  // status words (GREEN/RED) the keyword list does not enumerate. But two adjacent
  // ALL-CAPS words joined by " or " ALSO appears in ordinary multi-item data
  // extractions where the pair is a set of candidate FIELD NAMES, not a binary
  // verdict ("report the ISBN or SKU for each book"). Routing those to verdict
  // mode collapses a per-row list to one token and drops data. Only treat the
  // or-shape as a verdict when the whole clause IS the choice — reject it when the
  // instruction reads as an enumerated field list.
  const orShape = /\b[A-Z][A-Z0-9_]*\b\s+or\s+\b[A-Z][A-Z0-9_]*\b/;
  return orShape.test(text) && !isEnumeratedFieldList(text);
}

// True when a "CAPS or CAPS" pair reads as a field-name enumeration inside a
// larger multi-item data extraction, rather than a binary status verdict. Two
// general tells, either sufficient:
//   1. an enumeration cue anywhere ("for each", "every", "of each", "per row"…),
//      the hallmark of a per-item/list extraction; or
//   2. the CAPS pair is immediately followed by a lowercase CONTENT word — a
//      common noun the CAPS modify as a field label ("USD or EUR price", "Q1 or
//      Q2 revenue"). A genuine verdict's tokens ARE the reported value, so what
//      follows them is nothing or a clause connective ("… depending on …", "…
//      if logged in …"), never a field noun — those connectives are excluded.
function isEnumeratedFieldList(text) {
  const enumCue = /\b(?:for each|for every|each|every|per row|per item|per record|of each|of every)\b/i;
  if (enumCue.test(text)) return true;
  // Word directly following the second CAPS token of the or-pair, if any.
  const trailing = /\b[A-Z][A-Z0-9_]*\b\s+or\s+\b[A-Z][A-Z0-9_]*\b\s+([a-z][a-z0-9-]*)/;
  const m = trailing.exec(text);
  if (!m) return false;
  // Clause connectives that legitimately trail a verdict choice (not field nouns).
  const connective = /^(?:if|when|while|unless|otherwise|else|depending|based|according|because|since|and|with|for|from|to|on|in|the|a|an)$/;
  return !connective.test(m[1]);
}

function makeExtractInstructionMessage(userPrompt, pageContext) {
  const verdictBlock = isVerdictExtractPrompt(userPrompt) ? VERDICT_EXTRACT_GUIDANCE : '';
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
Return valid JSON array ONLY. Nothing else.${verdictBlock}`;

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
  const verdictBlock = isVerdictExtractPrompt(userPrompt) ? VERDICT_EXTRACT_GUIDANCE : '';
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
Return valid JSON array ONLY. Nothing else.${verdictBlock}`;

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

// ── Visual mode prompts (Set-of-Marks) ─────────────────────────────────────
// The model reads a marked screenshot instead of an ARIA/DOM snapshot, but
// MUST reply in the SAME JSON shapes the text find/extract prompts already
// emit, so downstream parsing (baml-parser.js's parseFindElementsResponse /
// parseExtractionResponse) and verdict handling need ZERO changes. Find
// replies as a one-element JSON array of descriptor objects —
// [{"mark": "<label>"}] — mirroring the existing [{"role":...}] /
// [{"x":...}] descriptor-array shape (never raw pixel coordinates, per spec:
// Set-of-Marks only). Extract reuses the identical extraction framing
// (JSON array, "If nothing found, return empty array: []"), so a visual
// extract reply parses exactly like a text extract reply, verdict guidance
// included.
//
// Mark identity is the drawn LABEL STRING, not a sequential integer.
// AnnotationService draws the ref-label text verbatim on the overlay pixels
// (elements: "@e0"/"@c1"; grid cells: "r0c0" — see AnnotationService.js's
// label.textContent = ref and renderGrid's ref === cellId), and that same
// string is VisualRepresenter.markMap's key. Those labels are the
// --annotate human-readable scheme (T-0143) and are NOT renumbered for the
// model — the model can only report what it visually reads off the pixels,
// so it must echo the label verbatim; markMap.get(<that label>) then
// resolves the element/cell directly. makeVisualFindMessage therefore takes
// the actual list of drawn labels (markLabels), not a count, so the model
// knows the valid label set to pick from.

function makeVisualFindMessage(userPrompt, markLabels) {
  const labels = Array.isArray(markLabels) ? markLabels : [];
  const labelList = labels.join(', ');

  const systemPrompt = `You are helping the user automate the browser by finding an element in a screenshot annotated with labeled marks (Set-of-Marks).

You will be given:
1. An instruction describing the element to find
2. A screenshot where candidate elements (or grid cells, if no elements were detected) are outlined and labeled with a text label printed directly on the image (e.g. "@e2" for an element, "r0c0" for a grid cell)

The valid labels in this image are: ${labelList}

Return ONLY a valid JSON array containing ONE object with the following property:
  - "mark": the exact label text (a string, e.g. "@e2" or "r0c0") printed on the mark that matches the instruction — reproduce it verbatim, exactly as shown in the image. Do not invent a label that is not listed above, and do not renumber or reformat it.

Example: [{"mark":"@e2"}]

If nothing in the image matches, return an empty array: []
Never return raw pixel coordinates — only one of the listed labels, verbatim.
Do not include any other text, explanation, or markdown formatting. Return ONLY the JSON array.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User Instructions: ${userPrompt}\nMarks available: ${labelList}` }
  ];
}

function makeVisualExtractMessage(userPrompt) {
  const verdictBlock = isVerdictExtractPrompt(userPrompt) ? VERDICT_EXTRACT_GUIDANCE : '';
  const systemPrompt = `You are a JSON extraction tool. Your ONLY task is to read a screenshot and return valid JSON.

CRITICAL RULES:
- Return ONLY a JSON array (starting with [ and ending with ])
- Do NOT include any text before or after the JSON
- Do NOT use markdown code blocks or backticks
- Do NOT include explanations, headers, or titles
- Extract exactly what the user asks for
- If nothing found, return empty array: []

You will be given:
1. An extraction instruction
2. A screenshot of the page to read the value from

Read the exact text as shown in the image, preserving symbols and line breaks.
Return valid JSON array ONLY. Nothing else.${verdictBlock}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Extract: ${userPrompt}\nFrom the attached screenshot.` }
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
  // visual mode (Set-of-Marks)
  makeVisualFindMessage,
  makeVisualExtractMessage,
};
