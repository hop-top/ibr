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

const PSEUDO_BUTTON_GUIDANCE = `
The snapshot may include two sections:
1. Standard ARIA elements with @e refs (buttons, links, inputs)
2. Pseudo-interactive elements with @c refs (divs/spans with cursor:pointer or onclick)
Prefer @e refs; use @c refs only for custom interactive components not in the ARIA tree.`;

function makeFindInstructionMessage(userPrompt, domTree) {
  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to find in the page.

You will be given:
1. a instruction of elements to find
2. a hierarchical tree showing the semantic structure of the page. The tree is a JSON representation of the DOM. Where "n" is tag name,  "t" text content, "a" list of attributes, "c" is the list of children elements.

You MUST return ONLY a valid JSON array of elements that match the instruction if they exist, otherwise return an empty array. Do not include any other text, explanation, or markdown formatting. Return ONLY the JSON array.
${PSEUDO_BUTTON_GUIDANCE}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User Instructions: ${userPrompt}\nTree: ${domTree}` }
  ];
}

function makeActionInstructionMessage(userPrompt, domTree) {
  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to act on in the page.

You will be given:
1. a instruction of elements to find for the action
2. a hierarchical tree showing the semantic structure of the page. The tree is a JSON representation of the DOM. Where "n" is tag name,  "t" text content, "a" list of attributes, "c" is the list of children elements.

Return ONLY a valid JSON object with the following properties:
1. elements: an array of elements that match the instruction if they exist, elements should support the action type, otherwise return an empty array.
2. type: name of action to perform on the element, can be "click" or "fill" or "type" or "press" or "scroll".
3. value: value to fill or type or press.

Do not include any other text, explanation, or markdown formatting. Return ONLY the JSON object.
${PSEUDO_BUTTON_GUIDANCE}`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Instructions: ${userPrompt}\nTree: ${domTree}` }
  ]
}

function makeExtractInstructionMessage(userPrompt, domTree) {
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
2. A DOM tree to extract from

Extract the exact text with all symbols and line breaks preserved.
Return valid JSON array ONLY. Nothing else.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Extract: ${userPrompt}\nFrom DOM: ${domTree}` }
  ];
}
export { makeTaskDescriptionMessage, makeFindInstructionMessage, makeActionInstructionMessage, makeExtractInstructionMessage };