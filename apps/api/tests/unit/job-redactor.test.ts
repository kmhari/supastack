import { describe, it, expect } from 'vitest';
import { redactSensitive } from '../../src/services/job-redactor.js';

describe('redactSensitive', () => {
  it('masks Postgres connection strings', () => {
    const out = redactSensitive('failed to connect: postgres://admin:s3cret@db:5432/postgres');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('s3cret');
    expect(out).not.toContain('postgres://admin');
  });

  it('masks PATs, bearer tokens, and password pairs', () => {
    expect(redactSensitive('token sbp_ad2d323fabc7428755ef274b58336394bda1847c')).toBe(
      'token [REDACTED]',
    );
    expect(redactSensitive('Authorization: Bearer eyJhbGci.abc-DEF_123')).toContain('[REDACTED]');
    expect(redactSensitive('Authorization: Bearer eyJhbGci.abc-DEF_123')).not.toContain('eyJhbGci');
    expect(redactSensitive('PGPASSWORD password=hunter2 done')).toBe('PGPASSWORD [REDACTED] done');
  });

  it('leaves clean text untouched (sad path: nothing to redact)', () => {
    const clean = 'instance ogql123 provision failed: health check timeout after 60s';
    expect(redactSensitive(clean)).toBe(clean);
  });

  it('handles null/undefined/empty without throwing', () => {
    expect(redactSensitive(null)).toBe('');
    expect(redactSensitive(undefined)).toBe('');
    expect(redactSensitive('')).toBe('');
  });
});
