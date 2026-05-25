import { describe, expect, it } from 'vitest';
import { RESERVED_SECRET_NAMES, validateSecretName } from '../../src/services/secret-store.js';

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
    const wellFormed = ['FOO', 'STRIPE_KEY', 'A', 'A1', 'A_B_C', 'X'.repeat(64)];
    it.each(wellFormed)('%s passes', (name) => {
      expect(validateSecretName(name)).toEqual({ ok: true });
    });
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

  it.each(['JWT_SECRET', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL'])(
    'reserved name %s fails with code: reserved_name',
    (name) => {
      const result = validateSecretName(name);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('reserved_name');
      }
    },
  );

  // Feature 010 follow-up: names that USED to be reserved but are not
  // injected into the functions container env — they're only visible to
  // other per-project containers (db, studio, realtime, analytics, meta).
  // Operators may legitimately want these as user secrets (e.g.,
  // POSTGRES_PASSWORD pointing at a DIFFERENT db from an edge function).
  it.each(['ANON_KEY', 'SERVICE_ROLE_KEY', 'POSTGRES_PASSWORD', 'POSTGRES_HOST', 'VAULT_ENC_KEY', 'DASHBOARD_PASSWORD', 'PG_META_CRYPTO_KEY', 'LOGFLARE_PUBLIC_ACCESS_TOKEN', 'SECRET_KEY_BASE'])(
    'name %s is NOT reserved (not in functions container env)',
    (name) => {
      const result = validateSecretName(name);
      expect(result.ok).toBe(true);
    },
  );

  it('RESERVED_SECRET_NAMES includes every functions-container-injected env var', () => {
    expect(RESERVED_SECRET_NAMES).toContain('JWT_SECRET');
    expect(RESERVED_SECRET_NAMES).toContain('SUPABASE_URL');
    expect(RESERVED_SECRET_NAMES).toContain('SUPABASE_ANON_KEY');
    expect(RESERVED_SECRET_NAMES).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(RESERVED_SECRET_NAMES).toContain('SUPABASE_DB_URL');
    expect(RESERVED_SECRET_NAMES).toContain('SB_REF');
    expect(RESERVED_SECRET_NAMES).toContain('SELFBASE_VAULT_TTL_MS');
  });
});
