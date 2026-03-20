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

// Dialog manager
function parseEnvBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const val = String(raw).trim();
  if (val === '') return defaultValue;
  return val === 'true';
}

export const DIALOG_AUTO_ACCEPT = parseEnvBool('DIALOG_AUTO_ACCEPT', true);
export const DIALOG_BUFFER_CAPACITY = parseEnvPositiveInt('DIALOG_BUFFER_CAPACITY', 50000);
export const DIALOG_DEFAULT_PROMPT_TEXT = process.env.DIALOG_DEFAULT_PROMPT_TEXT ?? '';
export const STANDARD_INTERACTIVE_TAGS =
  ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS'];
export const PSEUDO_BUTTON_TEXT_MAX_LENGTH = 80;
