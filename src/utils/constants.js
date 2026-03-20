// Delay in milliseconds for various operations

function parseEnvMs(name, defaultValue) {
  const val = parseInt(process.env[name] ?? String(defaultValue), 10);
  return Number.isFinite(val) && val >= 0 ? val : defaultValue;
}

export const PAGE_LOADING_DELAY_MS = parseEnvMs('PAGE_LOADING_DELAY_MS', 2500);
export const INSTRUCTION_EXECUTION_DELAY_MS = parseEnvMs('INSTRUCTION_EXECUTION_DELAY_MS', 2000);
export const INSTRUCTION_EXECUTION_JITTER_MS = parseEnvMs('INSTRUCTION_EXECUTION_JITTER_MS', 500);

function parseEnvPositiveInt(name, defaultValue) {
  const val = parseInt(process.env[name] ?? String(defaultValue), 10);
  return Number.isFinite(val) && val > 0 ? val : defaultValue;
}

// Pseudo-button detection
export const PSEUDO_BUTTON_LIMIT = parseEnvPositiveInt('PSEUDO_BUTTON_LIMIT', 100);
export const STANDARD_INTERACTIVE_TAGS =
  ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS'];
export const PSEUDO_BUTTON_TEXT_MAX_LENGTH = 80;
