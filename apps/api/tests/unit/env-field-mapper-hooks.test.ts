/**
 * Auth hooks field classification — feature 082 / issue #64.
 *
 * Verifies all 21 hook_* fields are classified 'honored' with correct
 * GoTrue env var names, and that _secrets fields carry secret: true.
 *
 * Spec: specs/082-auth-hooks/spec.md FR-001, FR-002
 * Plan: specs/082-auth-hooks/plan.md §A
 */

import { describe, it, expect } from 'vitest';
import { AUTH_CONFIG_FIELD_STATUS } from '../../src/services/env-field-mapper.js';

const HOOK_TYPES = [
  'custom_access_token',
  'mfa_verification_attempt',
  'password_verification_attempt',
  'send_sms',
  'send_email',
  'before_user_created',
  'after_user_created',
] as const;

const EXPECTED_ENV_VARS: Record<string, string> = {
  hook_custom_access_token_enabled:          'GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED',
  hook_custom_access_token_uri:              'GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI',
  hook_custom_access_token_secrets:          'GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS',
  hook_mfa_verification_attempt_enabled:    'GOTRUE_HOOK_MFA_VERIFICATION_ATTEMPT_ENABLED',
  hook_mfa_verification_attempt_uri:        'GOTRUE_HOOK_MFA_VERIFICATION_ATTEMPT_URI',
  hook_mfa_verification_attempt_secrets:    'GOTRUE_HOOK_MFA_VERIFICATION_ATTEMPT_SECRETS',
  hook_password_verification_attempt_enabled: 'GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_ENABLED',
  hook_password_verification_attempt_uri:     'GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI',
  hook_password_verification_attempt_secrets: 'GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_SECRETS',
  hook_send_sms_enabled:   'GOTRUE_HOOK_SEND_SMS_ENABLED',
  hook_send_sms_uri:       'GOTRUE_HOOK_SEND_SMS_URI',
  hook_send_sms_secrets:   'GOTRUE_HOOK_SEND_SMS_SECRETS',
  hook_send_email_enabled: 'GOTRUE_HOOK_SEND_EMAIL_ENABLED',
  hook_send_email_uri:     'GOTRUE_HOOK_SEND_EMAIL_URI',
  hook_send_email_secrets: 'GOTRUE_HOOK_SEND_EMAIL_SECRETS',
  hook_before_user_created_enabled: 'GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED',
  hook_before_user_created_uri:     'GOTRUE_HOOK_BEFORE_USER_CREATED_URI',
  hook_before_user_created_secrets: 'GOTRUE_HOOK_BEFORE_USER_CREATED_SECRETS',
  hook_after_user_created_enabled:  'GOTRUE_HOOK_AFTER_USER_CREATED_ENABLED',
  hook_after_user_created_uri:      'GOTRUE_HOOK_AFTER_USER_CREATED_URI',
  hook_after_user_created_secrets:  'GOTRUE_HOOK_AFTER_USER_CREATED_SECRETS',
};

describe('env-field-mapper: auth hook fields (feature 082)', () => {
  it('all 21 hook_* fields are classified honored', () => {
    for (const [field] of Object.entries(EXPECTED_ENV_VARS)) {
      const status = AUTH_CONFIG_FIELD_STATUS[field];
      expect(status, `${field} missing from AUTH_CONFIG_FIELD_STATUS`).toBeDefined();
      expect(status!.kind, `${field} should be honored`).toBe('honored');
    }
  });

  it('each hook_* field maps to the correct GOTRUE_HOOK_* env var', () => {
    for (const [field, envName] of Object.entries(EXPECTED_ENV_VARS)) {
      const status = AUTH_CONFIG_FIELD_STATUS[field];
      expect(status!.kind).toBe('honored');
      if (status?.kind === 'honored') {
        expect(status.envName, `${field} env var mismatch`).toBe(envName);
      }
    }
  });

  it('all 7 hook_*_secrets fields carry secret: true', () => {
    for (const hookType of HOOK_TYPES) {
      const field = `hook_${hookType}_secrets`;
      const status = AUTH_CONFIG_FIELD_STATUS[field];
      expect(status, `${field} missing`).toBeDefined();
      expect(status!.kind).toBe('honored');
      if (status?.kind === 'honored') {
        expect(status.secret, `${field} should have secret: true`).toBe(true);
      }
    }
  });

  it('hook_*_enabled and hook_*_uri fields do NOT carry secret: true', () => {
    for (const hookType of HOOK_TYPES) {
      for (const suffix of ['enabled', 'uri'] as const) {
        const field = `hook_${hookType}_${suffix}`;
        const status = AUTH_CONFIG_FIELD_STATUS[field];
        expect(status!.kind).toBe('honored');
        if (status?.kind === 'honored') {
          expect(status.secret, `${field} should not be secret`).toBeUndefined();
        }
      }
    }
  });

  it('total honored count increased by exactly 19 net-new fields vs baseline 169', () => {
    // All 21 HOOKS_HONORED fields are honored; 2 were already honored before
    // this feature so the net new count is 19, giving a total of 188.
    const honoredCount = Object.values(AUTH_CONFIG_FIELD_STATUS).filter(
      (s) => s.kind === 'honored',
    ).length;
    expect(honoredCount).toBe(188);
  });
});
