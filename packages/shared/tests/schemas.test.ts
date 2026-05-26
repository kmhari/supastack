import { describe, it, expect } from 'vitest';
import {
  Email,
  Password,
  Slug,
  Ref,
  ApexDomain,
  SetupRequest,
  LoginRequest,
  TokenCreateRequest,
  InviteCreateRequest,
  InviteAcceptRequest,
  InstanceCreateRequest,
  InstancePatchRequest,
  InstanceUpgradeRequest,
  CredentialRevealRequest,
  OrgPatchRequest,
  ChallengeRecord,
  DnsCheckResult,
  WildcardCertInitiateResponse,
  WildcardCertVerifyResponse,
  RenewalHistoryItem,
  WildcardCertStatusResponse,
  BackupStoreConfig,
} from '../src/schemas';
import {
  UpdatePostgrestConfigBodySchema,
  PostgrestConfigResponseSchema,
  POSTGREST_CONFIG_DEFAULTS,
} from '../src/schemas/mgmt-api-postgrest-config';
import {
  UpdateAuthConfigBodySchema,
  AuthConfigResponseSchema,
  ALL_AUTH_CONFIG_FIELDS,
  SECRET_FIELDS,
  REDACTED_SECRET,
} from '../src/schemas/mgmt-api-auth-config';

describe('primitives', () => {
  it('Email accepts/lowercases', () => {
    expect(Email.parse('A@B.CO')).toBe('a@b.co');
    expect(() => Email.parse('not-an-email')).toThrow();
  });
  it('Password length bounds', () => {
    expect(Password.parse('a'.repeat(8))).toBeDefined();
    expect(() => Password.parse('short')).toThrow();
    expect(() => Password.parse('a'.repeat(257))).toThrow();
  });
  it('Slug pattern', () => {
    expect(Slug.parse('a')).toBe('a');
    expect(Slug.parse('abc-123')).toBe('abc-123');
    expect(() => Slug.parse('')).toThrow();
    expect(() => Slug.parse('-bad')).toThrow();
    expect(() => Slug.parse('UP')).toThrow();
  });
  it('Ref must be 20 lowercase alphanumeric', () => {
    expect(Ref.parse('abcdefghijklmnopqrst')).toBeDefined();
    expect(() => Ref.parse('short')).toThrow();
    expect(() => Ref.parse('ABCDEFGHIJKLMNOPQRST')).toThrow();
  });
  it('ApexDomain', () => {
    expect(ApexDomain.parse('example.com')).toBeDefined();
    expect(() => ApexDomain.parse('nodot')).toThrow();
  });
});

describe('SetupRequest', () => {
  it('accepts', () => {
    expect(
      SetupRequest.parse({
        email: 'a@b.co',
        password: 'longenough',
        orgName: 'X',
      }),
    ).toBeDefined();
  });
  it('rejects bad email', () => {
    const r = SetupRequest.safeParse({ email: 'x', password: 'longenough', orgName: 'X' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toContain('email');
  });
});

describe('LoginRequest / TokenCreateRequest / InviteCreateRequest / InviteAcceptRequest', () => {
  it('Login accepts and rejects empty password', () => {
    expect(LoginRequest.parse({ email: 'a@b.co', password: 'x' })).toBeDefined();
    expect(LoginRequest.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
  it('TokenCreateRequest label bounds', () => {
    expect(TokenCreateRequest.parse({ label: 'l' })).toBeDefined();
    expect(TokenCreateRequest.safeParse({ label: '' }).success).toBe(false);
  });
  it('InviteCreateRequest enum', () => {
    expect(InviteCreateRequest.parse({ email: 'a@b.co', role: 'admin' })).toBeDefined();
    expect(InviteCreateRequest.safeParse({ email: 'a@b.co', role: 'owner' }).success).toBe(false);
  });
  it('InviteAcceptRequest token length', () => {
    expect(
      InviteAcceptRequest.parse({ token: 'x'.repeat(32), password: 'longenough' }),
    ).toBeDefined();
    expect(InviteAcceptRequest.safeParse({ token: 'short', password: 'longenough' }).success).toBe(
      false,
    );
  });
});

describe('InstanceCreateRequest', () => {
  it('accepts minimal', () => {
    const r = InstanceCreateRequest.parse({ name: 'proj' });
    expect(r.enableSignup).toBe(true);
    expect(r.jwtExpirySec).toBe(3600);
    expect(r.backupRetain).toBe(7);
  });
  it('rejects bad dbPassword chars', () => {
    expect(InstanceCreateRequest.safeParse({ name: 'x', dbPassword: 'has space12' }).success).toBe(
      false,
    );
    expect(InstanceCreateRequest.safeParse({ name: 'x', dbPassword: 'with$dollar' }).success).toBe(
      false,
    );
  });
  it('accepts good dbPassword', () => {
    expect(InstanceCreateRequest.parse({ name: 'x', dbPassword: 'abcdefgh12' })).toBeDefined();
  });
  it('rejects jwtExpirySec out of range', () => {
    expect(InstanceCreateRequest.safeParse({ name: 'x', jwtExpirySec: 1 }).success).toBe(false);
  });
  it('accepts smtp block', () => {
    expect(
      InstanceCreateRequest.parse({
        name: 'x',
        smtp: { host: 'h', port: 25, user: 'u', password: 'p' },
      }),
    ).toBeDefined();
  });
  it('rejects smtp bad port', () => {
    expect(
      InstanceCreateRequest.safeParse({
        name: 'x',
        smtp: { host: 'h', port: 0, user: 'u', password: 'p' },
      }).success,
    ).toBe(false);
  });
});

describe('InstancePatchRequest / Upgrade / CredentialReveal / OrgPatch', () => {
  it('InstancePatchRequest strict', () => {
    expect(InstancePatchRequest.parse({ name: 'x' })).toBeDefined();
    expect(InstancePatchRequest.safeParse({ extra: 1 } as never).success).toBe(false);
  });
  it('InstanceUpgradeRequest default', () => {
    const r = InstanceUpgradeRequest.parse({ supabaseVersion: 'v1' });
    expect(r.backupFirst).toBe(true);
  });
  it('CredentialRevealRequest needs password', () => {
    expect(CredentialRevealRequest.safeParse({ password: '' }).success).toBe(false);
    expect(CredentialRevealRequest.parse({ password: 'x' })).toBeDefined();
  });
  it('OrgPatchRequest strict rejects unknown', () => {
    expect(OrgPatchRequest.parse({ name: 'X' })).toBeDefined();
    expect(OrgPatchRequest.safeParse({ extra: 1 } as never).success).toBe(false);
  });
});

describe('wildcard cert schemas', () => {
  it('ChallengeRecord/DnsCheckResult', () => {
    expect(ChallengeRecord.parse({ name: 'n', value: 'v' })).toBeDefined();
    expect(DnsCheckResult.parse({ name: 'n', value: 'v', found: true })).toBeDefined();
    expect(ChallengeRecord.safeParse({ name: 'n' } as never).success).toBe(false);
  });
  it('Initiate response literal', () => {
    expect(
      WildcardCertInitiateResponse.parse({
        apex: 'x.co',
        status: 'awaiting_dns',
        challengeRecords: [],
        ttlHint: 60,
      }),
    ).toBeDefined();
    expect(
      WildcardCertInitiateResponse.safeParse({
        apex: 'x.co',
        status: 'issued',
        challengeRecords: [],
        ttlHint: 60,
      }).success,
    ).toBe(false);
  });
  it('Verify response', () => {
    expect(WildcardCertVerifyResponse.parse({ status: 'issued' })).toBeDefined();
    expect(WildcardCertVerifyResponse.safeParse({ status: 'bogus' }).success).toBe(false);
  });
  it('Status response with null cert', () => {
    expect(WildcardCertStatusResponse.parse({ cert: null })).toBeDefined();
  });
  it('RenewalHistoryItem nullable fields', () => {
    expect(
      RenewalHistoryItem.parse({
        triggeredBy: 'initial',
        outcome: 'success',
        errorMessage: null,
        certNotAfter: null,
        startedAt: 's',
        finishedAt: null,
      }),
    ).toBeDefined();
  });
});

describe('BackupStoreConfig discriminated union', () => {
  it('local', () => {
    expect(BackupStoreConfig.parse({ kind: 'local' })).toEqual({ kind: 'local' });
  });
  it('s3 accepts', () => {
    expect(
      BackupStoreConfig.parse({
        kind: 's3',
        bucket: 'b',
        region: 'r',
        accessKeyId: 'a',
        secretAccessKey: 's',
      }),
    ).toBeDefined();
  });
  it('s3 rejects missing fields', () => {
    expect(BackupStoreConfig.safeParse({ kind: 's3', bucket: 'b' }).success).toBe(false);
  });
  it('unknown kind rejected', () => {
    expect(BackupStoreConfig.safeParse({ kind: 'gcs' } as never).success).toBe(false);
  });
});

describe('UpdatePostgrestConfigBodySchema', () => {
  it('accepts known fields', () => {
    expect(
      UpdatePostgrestConfigBodySchema.parse({ db_schema: 'public', max_rows: 100 }),
    ).toBeDefined();
  });
  it('db_pool nullable', () => {
    expect(UpdatePostgrestConfigBodySchema.parse({ db_pool: null })).toBeDefined();
  });
  it('rejects unknown fields (strict)', () => {
    expect(UpdatePostgrestConfigBodySchema.safeParse({ unknown: 1 } as never).success).toBe(false);
  });
  it('rejects out-of-range', () => {
    expect(UpdatePostgrestConfigBodySchema.safeParse({ max_rows: -1 }).success).toBe(false);
    expect(UpdatePostgrestConfigBodySchema.safeParse({ db_pool: 9999 }).success).toBe(false);
  });
  it('PostgrestConfigResponseSchema requires all', () => {
    expect(
      PostgrestConfigResponseSchema.parse({
        db_schema: 's',
        db_extra_search_path: 'p',
        max_rows: 1,
        db_pool: null,
      }),
    ).toBeDefined();
    expect(PostgrestConfigResponseSchema.safeParse({ db_schema: 's' }).success).toBe(false);
  });
  it('POSTGREST_CONFIG_DEFAULTS conforms', () => {
    expect(PostgrestConfigResponseSchema.parse(POSTGREST_CONFIG_DEFAULTS)).toBeDefined();
  });
});

describe('UpdateAuthConfigBodySchema', () => {
  it('accepts empty object', () => {
    expect(UpdateAuthConfigBodySchema.parse({})).toEqual({});
  });
  it('accepts a representative set', () => {
    expect(
      UpdateAuthConfigBodySchema.parse({
        site_url: 'https://x',
        disable_signup: false,
        jwt_exp: 3600,
        smtp_pass: 'p',
        mailer_otp_length: 6,
        password_min_length: 8,
        security_captcha_provider: 'turnstile',
      }),
    ).toBeDefined();
  });
  it('rejects unknown field (strict)', () => {
    expect(UpdateAuthConfigBodySchema.safeParse({ nope: 1 } as never).success).toBe(false);
  });
  it('rejects out-of-range jwt_exp', () => {
    expect(UpdateAuthConfigBodySchema.safeParse({ jwt_exp: 999999999 }).success).toBe(false);
  });
  it('rejects bad enum', () => {
    expect(
      UpdateAuthConfigBodySchema.safeParse({ security_captcha_provider: 'bogus' as never }).success,
    ).toBe(false);
    expect(UpdateAuthConfigBodySchema.safeParse({ sms_provider: 'bogus' as never }).success).toBe(
      false,
    );
  });
  it('accepts nullable fields', () => {
    expect(UpdateAuthConfigBodySchema.parse({ site_url: null })).toBeDefined();
  });
  it('mfa_otp_length range', () => {
    expect(UpdateAuthConfigBodySchema.safeParse({ mailer_otp_length: 5 }).success).toBe(false);
    expect(UpdateAuthConfigBodySchema.safeParse({ mailer_otp_length: 11 }).success).toBe(false);
  });
  it('AuthConfigResponseSchema equals request schema', () => {
    expect(AuthConfigResponseSchema).toBe(UpdateAuthConfigBodySchema);
  });
  it('ALL_AUTH_CONFIG_FIELDS non-empty and includes site_url', () => {
    expect(ALL_AUTH_CONFIG_FIELDS.length).toBeGreaterThan(100);
    expect(ALL_AUTH_CONFIG_FIELDS).toContain('site_url');
  });
  it('SECRET_FIELDS + REDACTED_SECRET exported', () => {
    expect(SECRET_FIELDS.has('smtp_pass')).toBe(true);
    expect(SECRET_FIELDS.has('site_url')).toBe(false);
    expect(REDACTED_SECRET).toBe('***');
  });
});
