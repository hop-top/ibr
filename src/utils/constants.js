// Delay in milliseconds for various operations
export const PAGE_LOADING_DELAY_MS =
  parseInt(process.env.PAGE_LOADING_DELAY_MS ?? '2500', 10);
export const INSTRUCTION_EXECUTION_DELAY_MS =
  parseInt(process.env.INSTRUCTION_EXECUTION_DELAY_MS ?? '2000', 10);
export const INSTRUCTION_EXECUTION_JITTER_MS =
  parseInt(process.env.INSTRUCTION_EXECUTION_JITTER_MS ?? '500', 10);

// Pseudo-button detection
export const PSEUDO_BUTTON_LIMIT =
  parseInt(process.env.PSEUDO_BUTTON_LIMIT ?? '100');
export const STANDARD_INTERACTIVE_TAGS =
  ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS'];
export const PSEUDO_BUTTON_TEXT_MAX_LENGTH = 80;
