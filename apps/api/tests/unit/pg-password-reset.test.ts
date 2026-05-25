import { describe, expect, it } from 'vitest';
import { buildResetSql } from '../../src/services/pg-password-reset.js';

/**
 * T031: focused unit tests for the PG password ALTER builder.
 *
 * The end-to-end docker-exec path is verified by live E2E
 * (tests/cli-e2e/pooler-drift-roundtrip.sh equivalent and the inline
 * verification done during implementation on the test VM). These pure
 * tests cover the security-sensitive bit — the SQL escape — without
 * needing a docker socket.
 */
describe('buildResetSql', () => {
  it('wraps two ALTER USER statements in a single PG transaction', () => {
    const sql = buildResetSql('plainPassword123');
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toMatch(/ALTER USER postgres WITH PASSWORD/);
    expect(sql).toMatch(/ALTER USER supabase_admin WITH PASSWORD/);
    // Both ALTERs use the same password.
    const matches = sql.match(/WITH PASSWORD '([^']*(?:''[^']*)*)'/g) ?? [];
    expect(matches).toHaveLength(2);
    expect(matches[0]).toBe(matches[1]);
  });

  it('escapes single quotes via PG doubling rule', () => {
    const sql = buildResetSql("p'wd");
    // ' → '' in the inner literal
    expect(sql).toContain("WITH PASSWORD 'p''wd'");
  });

  it('handles a password full of nothing but quotes', () => {
    const sql = buildResetSql("'''");
    // Three single quotes → six in the literal (each ' → '').
    expect(sql).toContain("WITH PASSWORD ''''''''");
  });

  it('does NOT touch other special characters (backslash, $, semicolon)', () => {
    const sql = buildResetSql('a$b\\c;d');
    // PG string literals (single-quoted, no E'') treat these literally.
    expect(sql).toContain("WITH PASSWORD 'a$b\\c;d'");
  });

  it('alphanumeric password (the generatePassword() output shape) round-trips identical', () => {
    const sql = buildResetSql('aBc123XyZ');
    expect(sql).toContain("WITH PASSWORD 'aBc123XyZ'");
  });

  it('produces deterministic output for the same input', () => {
    expect(buildResetSql('x')).toBe(buildResetSql('x'));
  });
});
