export type ErrorCode =
  | 'invalid_input'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'rate_limited'
  | 'internal'
  | 'reauth_required'
  | 'setup_complete'
  | 'master_key_missing'
  | 'port_pool_exhausted'
  | 'invalid_state_transition';

export interface AppErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toBody(): AppErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const errors = {
  invalidInput: (message: string, details?: unknown) =>
    new AppError(400, 'invalid_input', message, details),
  unauthenticated: (message = 'authentication required') =>
    new AppError(401, 'unauthenticated', message),
  reauthRequired: (message = 're-authentication required') =>
    new AppError(401, 'reauth_required', message),
  forbidden: (message = 'forbidden') => new AppError(403, 'forbidden', message),
  notFound: (message = 'not found') => new AppError(404, 'not_found', message),
  conflict: (message: string) => new AppError(409, 'conflict', message),
  setupComplete: () =>
    new AppError(410, 'setup_complete', 'first-time setup is already complete'),
  gone: (message: string) => new AppError(410, 'gone', message),
  rateLimited: (message = 'too many requests') => new AppError(429, 'rate_limited', message),
  internal: (message = 'internal error') => new AppError(500, 'internal', message),
  masterKeyMissing: () =>
    new AppError(500, 'master_key_missing', 'MASTER_KEY missing or invalid; refusing to start'),
  portPoolExhausted: () =>
    new AppError(503, 'port_pool_exhausted', 'no free ports available in the configured range'),
  invalidStateTransition: (from: string, to: string) =>
    new AppError(
      409,
      'invalid_state_transition',
      `cannot transition instance from '${from}' to '${to}'`,
    ),
};
