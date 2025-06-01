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

function makeFindInstructionMessage(userPrompt, domTree) {
  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to observe in the page.

You will be given:
1. a instruction of elements to observe
2. a hierarchical accessibility tree showing the semantic structure of the page. The tree is a JSON representation of the DOM. Where "n" is tag name,  "t" text content, "a" list of attributes, "c" is the list of children elements.

Return an array of elements that match the instruction if they exist, elements should match the instruction, otherwise return an empty array.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `User Instructions: ${userPrompt}\nTree: ${domTree}` }
  ];
}

function makeActionInstructionMessage(userPrompt, domTree) {
  const systemPrompt = `You are helping the user automate the browser by finding elements based on what the user wants to act on in the page.

You will be given:
1. a instruction of elements to find for the action
2. a hierarchical accessibility tree showing the semantic structure of the page. The tree is a JSON representation of the DOM. Where "n" is tag name,  "t" text content, "a" list of attributes, "c" is the list of children elements.

Return an object with the following properties:
1. elements: an array of elements that match the instruction if they exist, otherwise return an empty array.
2. type: name of action to perform on the element, can be "click" or "fill" or "type" or "press" or "scroll".
3. value: value to fill or type or press.`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Instructions: ${userPrompt}\nTree: ${domTree}` }
  ]
}

function makeExtractInstructionMessage(userPrompt, domTree) {
  const systemPrompt = `You are extracting content on behalf of a user.
  If a user asks you to extract a 'list' of information, or 'all' information, 
  YOU MUST EXTRACT ALL OF THE INFORMATION THAT THE USER REQUESTS.
   
  You will be given:
1. An instruction
2. A list of DOM elements to extract from.

Print the exact text from the DOM elements with all symbols, characters, and endlines as is.
Result is an array in JSON, if no result is found return an empty array.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Instructions: ${userPrompt}\nTree: ${domTree}` }
  ];
}
export { makeTaskDescriptionMessage, makeFindInstructionMessage, makeActionInstructionMessage, makeExtractInstructionMessage };