import { randomInt } from 'node:crypto';

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// Characters that MUST NEVER appear in any generated `.env` value because
// docker-compose's variable substitution interprets them. The Multibase
// huntvox failure was a `$` in POSTGRES_PASSWORD becoming `${VAR}` lookup.
const FORBIDDEN_IN_ENV = /[$`\\"'\s]/;

/**
 * Generate a password from `[A-Za-z0-9]`. Safe to write into a Docker Compose
 * `.env` file unquoted — no substitution, no escape hazards.
 */
export function generatePassword(length = 32): string {
  if (length < 8) throw new Error('password length must be >= 8');
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHANUM.charAt(randomInt(0, ALPHANUM.length));
  }
  return out;
}

/**
 * Assert a value is safe to write into a Docker Compose `.env` file unquoted.
 * Used as a hard guard before writing the per-instance .env (compose-template.ts).
 *
 * Rejects $, backtick, backslash, single/double quote, and whitespace.
 */
export function assertSafeForEnv(value: string, fieldName = 'value'): void {
  if (FORBIDDEN_IN_ENV.test(value)) {
    throw new Error(
      `${fieldName} contains a character forbidden in env files ` +
        `($, \`, \\\\, quote, or whitespace) — would be reinterpreted by Compose`,
    );
  }
}
