import pino, { type Logger, type LoggerOptions } from 'pino';

// Guard `process` access — `@supastack/shared`'s public surface is consumed by
// the web SPA (e.g. ProjectSecrets imports RESERVED_SECRETS), and Vite serves
// these files to a browser context where `process` is undefined. Reading it
// at module-load throws a ReferenceError that aborts every React render.
const _env: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

const LOG_LEVEL = _env.LOG_LEVEL ?? (_env.NODE_ENV === 'production' ? 'info' : 'debug');
const IS_PROD = _env.NODE_ENV === 'production';

const baseOptions: LoggerOptions = {
  level: LOG_LEVEL,
  base: { service: _env.SUPASTACK_SERVICE ?? 'supastack' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'password',
      'newPassword',
      'currentPassword',
      'jwt_secret',
      'anon_key',
      'service_role_key',
      'postgres_password',
      'dashboard_password',
      'token',
      'accessKeyId',
      'secretAccessKey',
      'MASTER_KEY',
      '*.password',
      '*.token',
      '*.jwt_secret',
      '*.service_role_key',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
};

const transport = IS_PROD
  ? undefined
  : {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
    };

export function makeLogger(bindings: Record<string, unknown> = {}): Logger {
  return pino({ ...baseOptions, transport }, undefined).child(bindings);
}

export const logger: Logger = makeLogger();
