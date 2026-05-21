import pino, { type Logger, type LoggerOptions } from 'pino';

const LOG_LEVEL =
  process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const IS_PROD = process.env.NODE_ENV === 'production';

const baseOptions: LoggerOptions = {
  level: LOG_LEVEL,
  base: { service: process.env.SELFBASE_SERVICE ?? 'selfbase' },
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
