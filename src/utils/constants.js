// Delay in milliseconds for various operations
export const PAGE_LOADING_DELAY_MS =
  parseInt(process.env.PAGE_LOADING_DELAY_MS ?? '2500', 10);
export const INSTRUCTION_EXECUTION_DELAY_MS =
  parseInt(process.env.INSTRUCTION_EXECUTION_DELAY_MS ?? '2000', 10);
export const INSTRUCTION_EXECUTION_JITTER_MS =
  parseInt(process.env.INSTRUCTION_EXECUTION_JITTER_MS ?? '500', 10);
