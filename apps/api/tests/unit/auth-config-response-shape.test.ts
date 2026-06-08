/**
 * Auth-config GET response shape — `_supastack.fieldStatus` extension.
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md FR-002, FR-003, SC-005
 * Contract: specs/020-auth-providers-dashboard/contracts/auth-config-get-response.md
 * Task: T051
 */

import { describe, it, expect } from 'vitest';
import { buildAuthFieldStatusExtension } from '../../src/services/runtime-config-store.js';
import { AUTH_CONFIG_FIELD_STATUS } from '../../src/services/env-field-mapper.js';

describe('buildAuthFieldStatusExtension', () => {
  const ext = buildAuthFieldStatusExtension();
  const entries = Object.entries(ext.fieldStatus);

  it('exposes a `fieldStatus` map with one entry per UpdateAuthConfigBody field', () => {
    expect(entries.length).toBe(Object.keys(AUTH_CONFIG_FIELD_STATUS).length);
    expect(entries.length).toBe(234);
  });

  it('honored entries carry { status: "honored", envName } and optional secret flag', () => {
    const honored = entries.filter(([, v]) => v.status === 'honored');
    expect(honored.length).toBeGreaterThan(0);
    for (const [field, projection] of honored) {
      expect(projection.envName, `honored ${field} has no envName`).toBeTruthy();
      if ('secret' in projection) {
        expect(projection.secret, `honored ${field} secret must be true if present`).toBe(true);
      }
    }
  });

  it('stored_only entries carry { status, reason } and reference an issue', () => {
    const stored = entries.filter(([, v]) => v.status === 'stored_only');
    expect(stored.length).toBeGreaterThan(0);
    for (const [field, projection] of stored) {
      expect(projection.reason, `stored_only ${field} has no reason`).toBeTruthy();
      expect(/#\d+/.test(projection.reason as string)).toBe(true);
    }
  });

  it('unsupported entries carry { status, reason } and reference an issue', () => {
    const unsup = entries.filter(([, v]) => v.status === 'unsupported');
    expect(unsup.length).toBe(6);
    for (const [field, projection] of unsup) {
      expect(projection.reason, `unsupported ${field} has no reason`).toBeTruthy();
      expect(/#\d+/.test(projection.reason as string)).toBe(true);
    }
  });

  it('includes representative samples of each status kind', () => {
    expect(ext.fieldStatus.jwt_exp).toEqual({ status: 'honored', envName: 'JWT_EXPIRY' });
    expect(ext.fieldStatus.external_google_secret).toEqual({
      status: 'honored',
      envName: 'GOTRUE_EXTERNAL_GOOGLE_SECRET',
      secret: true,
    });
    expect(ext.fieldStatus.saml_enabled?.status).toBe('stored_only');
    expect((ext.fieldStatus.saml_enabled?.reason as string).includes('#61')).toBe(true);
    expect(ext.fieldStatus.oauth_server_enabled?.status).toBe('unsupported');
    expect((ext.fieldStatus.oauth_server_enabled?.reason as string).includes('#63')).toBe(true);
  });

  it('CLI back-compat — stripping `_supastack` yields a byte-shape compatible with feature 009', () => {
    // Simulated: a GET response is `{ ...auth_config_fields, _supastack: { fieldStatus } }`.
    // The CLI consumes only the auth-config fields and ignores the unknown `_supastack` key
    // (FR-005 / SC-005). Verified by removing the extension and confirming no required
    // auth-config field name collides with `_supastack`.
    const allFields = Object.keys(AUTH_CONFIG_FIELD_STATUS);
    expect(allFields.includes('_supastack')).toBe(false);
  });
});
