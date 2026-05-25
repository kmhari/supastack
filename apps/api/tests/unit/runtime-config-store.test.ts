import { describe, expect, it } from 'vitest';
import { containerNameFor, defaultsFor } from '../../src/services/runtime-config-store.js';
import { REDACTED_SECRET, SECRET_FIELDS, POSTGREST_CONFIG_DEFAULTS } from '@selfbase/shared';

/**
 * T023 — runtime-config-store unit tests.
 *
 * Covers the pure helpers + a few semantic invariants. The full pipeline
 * (lock + DB + container restart) is covered by integration tests in
 * Phase 3+4; here we keep tests dependency-free.
 *
 * Spec: research.md R-003, R-004, R-008.
 */

describe('containerNameFor', () => {
  it('postgrest → selfbase-<ref>-rest-1', () => {
    expect(containerNameFor('abc12345defg67890hij', 'postgrest')).toBe(
      'selfbase-abc12345defg67890hij-rest-1',
    );
  });

  it('auth → selfbase-<ref>-auth-1', () => {
    expect(containerNameFor('abc12345defg67890hij', 'auth')).toBe(
      'selfbase-abc12345defg67890hij-auth-1',
    );
  });
});

describe('defaultsFor', () => {
  it('postgrest defaults match the shared module', () => {
    expect(defaultsFor('postgrest')).toEqual(POSTGREST_CONFIG_DEFAULTS);
  });

  it('auth defaults include jwt_exp = 3600', () => {
    expect(defaultsFor('auth').jwt_exp).toBe(3600);
  });

  it('auth defaults are a fresh copy (no shared reference)', () => {
    const a = defaultsFor('auth');
    const b = defaultsFor('auth');
    a.jwt_exp = 9999;
    expect(b.jwt_exp).toBe(3600);
  });
});

describe('REDACTED_SECRET sentinel', () => {
  it('is the literal three-character "***"', () => {
    expect(REDACTED_SECRET).toBe('***');
    expect(REDACTED_SECRET.length).toBe(3);
  });
});

describe('SECRET_FIELDS membership', () => {
  it('includes every OAuth provider secret', () => {
    for (const p of [
      'apple',
      'azure',
      'bitbucket',
      'discord',
      'facebook',
      'figma',
      'github',
      'gitlab',
      'google',
      'kakao',
      'keycloak',
      'notion',
      'slack',
      'spotify',
      'twitch',
      'twitter',
      'workos',
      'x',
      'zoom',
    ]) {
      expect(SECRET_FIELDS.has(`external_${p}_secret`), `missing external_${p}_secret`).toBe(true);
    }
  });

  it('includes SMTP password', () => {
    expect(SECRET_FIELDS.has('smtp_pass')).toBe(true);
  });

  it('includes captcha secret', () => {
    expect(SECRET_FIELDS.has('security_captcha_secret')).toBe(true);
  });

  it('does NOT include non-secret fields with "password" in the name', () => {
    // false-positive guard from the OpenAPI scan
    expect(SECRET_FIELDS.has('password_min_length')).toBe(false);
    expect(SECRET_FIELDS.has('mailer_notifications_password_changed_enabled')).toBe(false);
    expect(SECRET_FIELDS.has('security_update_password_require_reauthentication')).toBe(false);
  });
});
