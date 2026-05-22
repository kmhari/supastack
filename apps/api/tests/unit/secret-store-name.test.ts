import { describe, expect, it } from 'vitest';
import {
  RESERVED_SECRET_NAMES,
  validateSecretName,
} from '../../src/services/secret-store.js';

/**
 * T003a (b): name-validation guard for project secrets.
 *
 * Names that pass the validator are persisted into the per-instance .env
 * file and become Deno.env.get(name) inside edge functions. Names that fail
 * are returned to the CLI as 409 (reserved) or 422 (regex). See
 * specs/003-supabase-cli-compat-p0/research.md R-005.
 */
describe('validateSecretName', () => {
  describe('accepts well-formed names', () => {
    it.each(['FOO', 'STRIPE_KEY', 'A', 'A1', 'A_B_C', 'X'.repeat(64)])(
      '%s passes',
      (name) => {
        expect(validateSecretName(name)).toEqual({ ok: true });
      },
    );
  });

  describe('rejects format violations', () => {
    it.each([
      ['empty string', ''],
      ['lowercase start', 'foo'],
      ['mixed case', 'Foo'],
      ['leading digit', '1FOO'],
      ['leading underscore', '_FOO'],
      ['hyphen', 'FOO-BAR'],
      ['dot', 'FOO.BAR'],
      ['space', 'FOO BAR'],
      ['too long', 'X'.repeat(65)],
    ])('%s fails with code: validation', (_, name) => {
      const result = validateSecretName(name);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('validation');
      }
    });
  });

  it.each(['JWT_SECRET', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'POSTGRES_PASSWORD'])(
    'reserved name %s fails with code: reserved_name',
    (name) => {
      const result = validateSecretName(name);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('reserved_name');
      }
    },
  );

  it('RESERVED_SECRET_NAMES includes every platform-managed env var', () => {
    // Spot-check the critical ones from R-005:
    expect(RESERVED_SECRET_NAMES).toContain('JWT_SECRET');
    expect(RESERVED_SECRET_NAMES).toContain('SUPABASE_URL');
    expect(RESERVED_SECRET_NAMES).toContain('SUPABASE_ANON_KEY');
    expect(RESERVED_SECRET_NAMES).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(RESERVED_SECRET_NAMES).toContain('SUPABASE_DB_URL');
  });
});
