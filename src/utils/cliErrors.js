export class CliError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'CliError';
    this.code = code;
    this.step = options.step;
    this.action = options.action;
  }
}

export function ensureCliError(error, fallbackCode = 'RUNTIME_ERROR', overrides = {}) {
  if (error instanceof CliError) {
    if (overrides.code) error.code = overrides.code;
    if (overrides.step !== undefined) error.step = overrides.step;
    if (overrides.action !== undefined) error.action = overrides.action;
    return error;
  }

  const cliError = new CliError(
    overrides.code || error?.code || fallbackCode,
    overrides.message || error?.message || 'Unknown error',
    {
      cause: error,
      step: overrides.step ?? error?.step,
      action: overrides.action ?? error?.action,
    },
  );

  return cliError;
}

export function serializeCliError(error) {
  const payload = {
    error: {
      code: error.code || 'RUNTIME_ERROR',
      message: error.message || 'Unknown error',
    },
  };

  if (error.step !== undefined) {
    payload.error.step = error.step;
  }

  if (error.action !== undefined) {
    payload.error.action = error.action;
  }

  return payload;
}
