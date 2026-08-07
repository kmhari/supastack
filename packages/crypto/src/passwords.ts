import { randomInt } from 'node:crypto';

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Characters docker-compose reads as structure rather than as data. The
 * Multibase huntvox failure was a `$` in POSTGRES_PASSWORD becoming a `${VAR}`
 * lookup; a line break is worse, because the remainder becomes a new variable.
 *
 * Why each class is refused, as one enum with one classifier — the two rules
 * below differ only in whether a literal space is tolerated, so the classes
 * themselves are defined exactly once. Two independent regexes is how the guard
 * drifted the first time.
 */
export type EnvViolationClass =
  | 'line-break'
  | 'dollar'
  | 'backtick'
  | 'backslash'
  | 'quote'
  | 'whitespace';

const VIOLATION_LABEL: Record<EnvViolationClass, string> = {
  'line-break': 'a line break — Compose would read the remainder as a new assignment',
  dollar: '`$` — Compose would expand it against the host process environment',
  backtick: 'a backtick',
  backslash: 'a backslash',
  quote: 'a single or double quote',
  whitespace: 'whitespace',
};

/**
 * Classify the first forbidden character in `value`, or `null` if it is safe.
 *
 * `allowSpace` distinguishes the two rules:
 *  - `false` (generated secrets) — no whitespace of any kind
 *  - `true`  (platform + operator values) — a literal space is data, not
 *    structure. Demonstrated: a space cannot begin a new assignment, while a
 *    line break can (specs/121 research.md Q5, cases B and D). Upstream's own
 *    `.env.example` ships `STUDIO_DEFAULT_ORGANIZATION=Default Organization`.
 *
 * Every other whitespace character — tab included — stays forbidden under both
 * rules. No project name or mail host needs one.
 */
export function findEnvViolation(value: string, allowSpace = false): EnvViolationClass | null {
  for (const ch of value) {
    if (ch === '\n' || ch === '\r') return 'line-break';
    if (ch === '$') return 'dollar';
    if (ch === '`') return 'backtick';
    if (ch === '\\') return 'backslash';
    if (ch === '"' || ch === "'") return 'quote';
    if (/\s/.test(ch) && !(allowSpace && ch === ' ')) return 'whitespace';
  }
  return null;
}

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
 * Assert a GENERATED value is safe to write into a Docker Compose `.env` file
 * unquoted. Rejects $, backtick, backslash, single/double quote, and every
 * whitespace character.
 *
 * This is the strict rule, unchanged. It is right for values the server mints
 * (passwords, keys, tokens) and wrong for values a human types — see
 * `assertSafeForEnvValue`.
 */
export function assertSafeForEnv(value: string, fieldName = 'value'): void {
  const violation = findEnvViolation(value, false);
  if (violation) {
    throw new Error(
      `${fieldName} contains a character forbidden in env files ` +
        `(${VIOLATION_LABEL[violation]}) — would be reinterpreted by Compose`,
    );
  }
}

/**
 * Assert a PLATFORM- or OPERATOR-supplied value is safe to write into a Docker
 * Compose `.env` file unquoted. Identical to `assertSafeForEnv` except that a
 * literal space is permitted.
 *
 * A space is data: `STUDIO_DEFAULT_ORGANIZATION=My Project` is delivered whole,
 * and a space cannot begin a new assignment the way a line break can. Rejecting
 * it would reject upstream's own shipped default for that variable.
 *
 * Never echoes `value` — the caller may be passing a secret (specs/121 FR-004).
 */
export function assertSafeForEnvValue(value: string, fieldName = 'value'): void {
  const violation = findEnvViolation(value, true);
  if (violation) {
    throw new Error(
      `${fieldName} contains a character forbidden in env files ` +
        `(${VIOLATION_LABEL[violation]}) — would be reinterpreted by Compose`,
    );
  }
}
