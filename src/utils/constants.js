// Delay in milliseconds for various operations

function parseNonNegativeIntOrDefault(envValue, defaultValue) {
  const raw = envValue ?? '';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return defaultValue;
}

export const PAGE_LOADING_DELAY_MS =
  parseNonNegativeIntOrDefault(process.env.PAGE_LOADING_DELAY_MS, 2500);
export const INSTRUCTION_EXECUTION_DELAY_MS =
  parseNonNegativeIntOrDefault(process.env.INSTRUCTION_EXECUTION_DELAY_MS, 2000);
export const INSTRUCTION_EXECUTION_JITTER_MS =
  parseNonNegativeIntOrDefault(process.env.INSTRUCTION_EXECUTION_JITTER_MS, 500);
