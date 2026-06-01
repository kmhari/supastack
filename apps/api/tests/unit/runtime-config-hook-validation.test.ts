/**
 * Auth hook URI scheme + enabled-requires-URI validation (feature 082 / issue #64).
 *
 * Tests validateHookConfig() which is called from crossFieldValidate() inside
 * patchConfig(). Pure unit test — no DB or Redis required.
 *
 * Spec: specs/082-auth-hooks/spec.md FR-003, FR-004, FR-005
 * Contract: specs/082-auth-hooks/contracts/auth-config-hooks.md
 * Plan: specs/082-auth-hooks/plan.md §B
 */

import { describe, it, expect } from 'vitest';
import { validateHookConfig } from '../../src/services/runtime-config-store.js';
import { ManagementApiError } from '../../src/plugins/mgmt-api-errors.js';

function expectHookError(merged: Record<string, unknown>, code: string): void {
  let thrown: unknown;
  try {
    validateHookConfig(merged);
  } catch (e) {
    thrown = e;
  }
  expect(thrown, `expected ManagementApiError(${code}) to be thrown`).toBeInstanceOf(ManagementApiError);
  if (thrown instanceof ManagementApiError) {
    expect(thrown.code).toBe(code);
    expect(thrown.statusCode).toBe(400);
  }
}

function expectNoError(merged: Record<string, unknown>): void {
  expect(() => validateHookConfig(merged)).not.toThrow();
}

describe('validateHookConfig — URI scheme guard', () => {
  // Happy path
  it('accepts a valid pg-functions:// URI', () => {
    expectNoError({ hook_custom_access_token_uri: 'pg-functions://postgres/public/my_hook' });
  });

  it('accepts null URI (hook not configured)', () => {
    expectNoError({ hook_custom_access_token_uri: null });
  });

  it('accepts undefined URI (field absent from patch body)', () => {
    expectNoError({});
  });

  it('accepts empty string URI (field cleared)', () => {
    expectNoError({ hook_custom_access_token_uri: '' });
  });

  // Sad path
  it('rejects https:// URI with hook_uri_scheme_unsupported', () => {
    expectHookError(
      { hook_send_email_uri: 'https://my-service.example.com/hook' },
      'hook_uri_scheme_unsupported',
    );
  });

  it('rejects http:// URI with hook_uri_scheme_unsupported', () => {
    expectHookError(
      { hook_send_sms_uri: 'http://my-service.example.com/hook' },
      'hook_uri_scheme_unsupported',
    );
  });

  it('rejects grpc:// URI with hook_uri_scheme_unsupported', () => {
    expectHookError(
      { hook_mfa_verification_attempt_uri: 'grpc://internal/my-hook' },
      'hook_uri_scheme_unsupported',
    );
  });

  it('rejects arn:// URI with hook_uri_scheme_unsupported', () => {
    expectHookError(
      { hook_before_user_created_uri: 'arn:aws:lambda:us-east-1:123:function:my-hook' },
      'hook_uri_scheme_unsupported',
    );
  });

  it('error details include the offending field name', () => {
    let thrown: ManagementApiError | undefined;
    try {
      validateHookConfig({ hook_after_user_created_uri: 'https://bad.example.com' });
    } catch (e) {
      if (e instanceof ManagementApiError) thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown?.details).toMatchObject({ field: 'hook_after_user_created_uri' });
  });

  it('HTTPS error message mentions issue #64', () => {
    let thrown: ManagementApiError | undefined;
    try {
      validateHookConfig({ hook_send_email_uri: 'https://sender.example.com' });
    } catch (e) {
      if (e instanceof ManagementApiError) thrown = e;
    }
    expect(thrown?.message).toContain('#64');
  });
});

describe('validateHookConfig — enabled-requires-URI guard', () => {
  // Happy path
  it('allows enabled=true with a valid pg-functions:// URI', () => {
    expectNoError({
      hook_custom_access_token_enabled: true,
      hook_custom_access_token_uri: 'pg-functions://postgres/public/my_hook',
    });
  });

  it('allows enabled=false with no URI (hook disabled, URI not required)', () => {
    expectNoError({ hook_custom_access_token_enabled: false });
  });

  it('allows enabled=false with null URI', () => {
    expectNoError({ hook_send_email_enabled: false, hook_send_email_uri: null });
  });

  it('allows enabled=undefined with no URI (field absent)', () => {
    expectNoError({});
  });

  // Sad path
  it('rejects enabled=true with null URI with hook_uri_required', () => {
    expectHookError(
      { hook_mfa_verification_attempt_enabled: true, hook_mfa_verification_attempt_uri: null },
      'hook_uri_required',
    );
  });

  it('rejects enabled=true with undefined URI with hook_uri_required', () => {
    expectHookError(
      { hook_password_verification_attempt_enabled: true },
      'hook_uri_required',
    );
  });

  it('rejects enabled=true with empty string URI with hook_uri_required', () => {
    expectHookError(
      { hook_before_user_created_enabled: true, hook_before_user_created_uri: '' },
      'hook_uri_required',
    );
  });

  it('error details include the URI field name (not the enabled field)', () => {
    let thrown: ManagementApiError | undefined;
    try {
      validateHookConfig({ hook_after_user_created_enabled: true });
    } catch (e) {
      if (e instanceof ManagementApiError) thrown = e;
    }
    expect(thrown?.details).toMatchObject({ field: 'hook_after_user_created_uri' });
  });
});

describe('validateHookConfig — all 7 hook types are validated', () => {
  const HOOK_TYPES = [
    'custom_access_token',
    'mfa_verification_attempt',
    'password_verification_attempt',
    'send_sms',
    'send_email',
    'before_user_created',
    'after_user_created',
  ] as const;

  for (const hookType of HOOK_TYPES) {
    it(`rejects https URI for hook_${hookType}_uri`, () => {
      expectHookError(
        { [`hook_${hookType}_uri`]: 'https://bad.example.com' },
        'hook_uri_scheme_unsupported',
      );
    });

    it(`rejects enabled=true without URI for hook_${hookType}`, () => {
      expectHookError(
        { [`hook_${hookType}_enabled`]: true },
        'hook_uri_required',
      );
    });
  }
});
