// Delay in milliseconds for various operations

function parseEnvMs(name, defaultValue) {
  const val = parseInt(process.env[name] ?? String(defaultValue), 10);
  return Number.isFinite(val) && val >= 0 ? val : defaultValue;
}

export const PAGE_LOADING_DELAY_MS = parseEnvMs('PAGE_LOADING_DELAY_MS', 2500);
export const INSTRUCTION_EXECUTION_DELAY_MS = parseEnvMs('INSTRUCTION_EXECUTION_DELAY_MS', 2000);
export const INSTRUCTION_EXECUTION_JITTER_MS = parseEnvMs('INSTRUCTION_EXECUTION_JITTER_MS', 500);
