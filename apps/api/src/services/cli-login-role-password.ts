/**
 * Random password generator for the CLI login-role endpoint (feature 012).
 *
 * Each successful POST to /v1/projects/:ref/cli/login-role rotates the
 * persistent `cli_login_*` role's password to a fresh value produced here.
 *
 * Decision 5 in specs/012-cli-login-role/research.md:
 *   crypto.randomBytes(32).toString('hex') → 64-char lowercase hex string.
 *   256 bits of entropy. Hex encoding has no characters that need SQL
 *   escaping, so the value is safe to interpolate into the ALTER ROLE
 *   clause directly; implementation should still pass it through
 *   pg.escapeLiteral (or use server-side `EXECUTE format(%L)`) for defence
 *   in depth — see cli-login-role-service.ts.
 *
 * Postgres `ALTER ROLE` is a utility statement and does NOT accept bind
 * parameters for the password value; the safety story here is "256 bits of
 * entropy with a character class incompatible with SQL injection."
 */
import { randomBytes } from 'node:crypto';

/** Number of random bytes produced per password. 32 = 256 bits of entropy. */
export const PASSWORD_BYTES = 32;

/**
 * Generate a fresh random password for a `cli_login_*` role.
 *
 * Returns a 64-character lowercase hex string. Each call produces a unique
 * value (collision probability ≈ 2^-256, i.e. astronomically negligible).
 */
export function generateCliPassword(): string {
  return randomBytes(PASSWORD_BYTES).toString('hex');
}
