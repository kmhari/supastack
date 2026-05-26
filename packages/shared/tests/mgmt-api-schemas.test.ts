import { describe, it, expect } from 'vitest';
import {
  PatFormat,
  FunctionSlug,
  ManagementRef,
  ErrorEnvelope,
  ProfileSchema,
  OrganizationSchema,
  ProjectStatus,
  ProjectSchema,
  ApiKeyName,
  ApiKeySchema,
  FunctionStatus,
  FunctionSchema,
  DeployFunctionResponseSchema,
  FunctionDeployMetadataSchema,
  EszipDeployQuerySchema,
  EszipUpdateQuerySchema,
  BulkUpdateFunctionEntrySchema,
  BulkUpdateFunctionBodySchema,
  BulkUpdateFunctionResponseSchema,
  SecretNameFormat,
  SecretInputSchema,
  SecretSetBodySchema,
  SecretListEntrySchema,
  SecretDeleteBodySchema,
  UuidV4,
  CliLoginMintRequestSchema,
  CliLoginMintResponseSchema,
  CliLoginResponseSchema,
  CreateLoginRoleBody,
  CreateLoginRoleResponse,
  DeleteLoginRolesResponse,
  DbQueryBodySchema,
  DbQueryResponseSchema,
  DbDumpBodySchema,
  DbDumpDryRunResponseSchema,
} from '../src/mgmt-api-schemas';

const UUID = '11111111-2222-3333-4444-555555555555';
const VALID_PAT = 'sbp_' + 'a'.repeat(40);
const HEX130 = '04' + 'a'.repeat(128);

describe('mgmt-api primitives', () => {
  it('PatFormat', () => {
    expect(PatFormat.parse(VALID_PAT)).toBeDefined();
    expect(PatFormat.parse('sbp_oauth_' + 'b'.repeat(40))).toBeDefined();
    expect(PatFormat.safeParse('nope').success).toBe(false);
  });
  it('FunctionSlug', () => {
    expect(FunctionSlug.parse('hello-world')).toBeDefined();
    expect(FunctionSlug.safeParse('Hello').success).toBe(false);
    expect(FunctionSlug.safeParse('a'.repeat(49)).success).toBe(false);
  });
  it('ManagementRef', () => {
    expect(ManagementRef.parse('a'.repeat(20))).toBeDefined();
    expect(ManagementRef.parse('a'.repeat(32))).toBeDefined();
    expect(ManagementRef.safeParse('short').success).toBe(false);
  });
});

describe('error envelope + profile/org/project/api-key', () => {
  it('ErrorEnvelope', () => {
    expect(ErrorEnvelope.parse({ message: 'm' })).toBeDefined();
    expect(ErrorEnvelope.parse({ message: 'm', code: 'c', details: { a: 1 } })).toBeDefined();
    expect(ErrorEnvelope.safeParse({}).success).toBe(false);
  });
  it('ProfileSchema needs uuid + email', () => {
    expect(ProfileSchema.parse({ id: UUID, primary_email: 'a@b.co' })).toBeDefined();
    expect(ProfileSchema.safeParse({ id: 'nope', primary_email: 'a@b.co' }).success).toBe(false);
  });
  it('OrganizationSchema', () => {
    expect(OrganizationSchema.parse({ id: 'x', name: 'y' })).toBeDefined();
  });
  it('ProjectStatus enum + ProjectSchema', () => {
    expect(ProjectStatus.parse('ACTIVE_HEALTHY')).toBe('ACTIVE_HEALTHY');
    expect(ProjectStatus.safeParse('NOPE').success).toBe(false);
    expect(
      ProjectSchema.parse({
        id: '1',
        ref: 'r',
        name: 'n',
        organization_id: 'o',
        region: 'r',
        created_at: 't',
        status: 'ACTIVE_HEALTHY',
      }),
    ).toBeDefined();
  });
  it('ApiKey', () => {
    expect(ApiKeyName.parse('anon')).toBe('anon');
    expect(ApiKeySchema.parse({ name: 'anon', api_key: 'k' })).toBeDefined();
    expect(ApiKeySchema.safeParse({ name: 'bad', api_key: 'k' }).success).toBe(false);
  });
});

describe('functions schemas', () => {
  const fn = {
    id: 'i',
    slug: 'my-fn',
    name: 'n',
    version: 1,
    status: 'ACTIVE' as const,
  };
  it('FunctionStatus + FunctionSchema', () => {
    expect(FunctionStatus.parse('ACTIVE')).toBe('ACTIVE');
    expect(FunctionSchema.parse(fn)).toBeDefined();
    expect(FunctionSchema.safeParse({ ...fn, version: 0 }).success).toBe(false);
    expect(DeployFunctionResponseSchema.parse(fn)).toBeDefined();
  });
  it('FunctionDeployMetadataSchema passthrough', () => {
    const r = FunctionDeployMetadataSchema.parse({
      entrypoint_path: 'e',
      extra: 'kept',
    });
    expect((r as unknown as { extra: string }).extra).toBe('kept');
    expect(FunctionDeployMetadataSchema.safeParse({}).success).toBe(false);
  });
  it('EszipDeployQuerySchema coerces verify_jwt', () => {
    const r = EszipDeployQuerySchema.parse({ slug: 'my-fn', verify_jwt: 'true' });
    expect(r.verify_jwt).toBe(true);
    expect(EszipDeployQuerySchema.safeParse({ slug: 'BAD' }).success).toBe(false);
    expect(EszipDeployQuerySchema.safeParse({ slug: 'my-fn', ezbr_sha256: 'zz' }).success).toBe(false);
  });
  it('EszipUpdateQuerySchema strips slug + name', () => {
    expect(EszipUpdateQuerySchema.parse({})).toBeDefined();
  });
  it('Bulk update schemas', () => {
    expect(BulkUpdateFunctionEntrySchema.parse(fn)).toBeDefined();
    expect(BulkUpdateFunctionBodySchema.parse([fn])).toBeDefined();
    expect(BulkUpdateFunctionResponseSchema.parse({ functions: [fn] })).toBeDefined();
  });
});

describe('secrets schemas', () => {
  it('SecretNameFormat', () => {
    expect(SecretNameFormat.parse('MY_VAR')).toBeDefined();
    expect(SecretNameFormat.safeParse('lowercase').success).toBe(false);
    expect(SecretNameFormat.safeParse('1BAD').success).toBe(false);
  });
  it('SecretInputSchema + SecretSetBodySchema', () => {
    expect(SecretInputSchema.parse({ name: 'A', value: 'v' })).toBeDefined();
    expect(SecretSetBodySchema.parse([{ name: 'A', value: 'v' }])).toBeDefined();
  });
  it('SecretListEntrySchema', () => {
    expect(SecretListEntrySchema.parse({ name: 'A', value: 'sha' })).toBeDefined();
  });
  it('SecretDeleteBodySchema is array of names', () => {
    expect(SecretDeleteBodySchema.parse(['A', 'B'])).toBeDefined();
    expect(SecretDeleteBodySchema.safeParse(['bad']).success).toBe(false);
  });
});

describe('CLI device-code login schemas', () => {
  it('UuidV4', () => {
    expect(UuidV4.parse(UUID)).toBe(UUID);
    expect(UuidV4.safeParse('nope').success).toBe(false);
  });
  it('CliLoginMintRequestSchema', () => {
    expect(
      CliLoginMintRequestSchema.parse({
        session_id: UUID,
        token_name: 'n',
        public_key: HEX130,
      }),
    ).toBeDefined();
    expect(
      CliLoginMintRequestSchema.safeParse({
        session_id: UUID,
        token_name: 'n',
        public_key: 'short',
      }).success,
    ).toBe(false);
  });
  it('CliLoginMintResponseSchema 8-hex', () => {
    expect(CliLoginMintResponseSchema.parse({ device_code: 'abcdef01' })).toBeDefined();
    expect(CliLoginMintResponseSchema.safeParse({ device_code: 'ZZ' }).success).toBe(false);
  });
  it('CliLoginResponseSchema', () => {
    expect(
      CliLoginResponseSchema.parse({
        id: UUID,
        created_at: '2026-05-25T00:00:00.000Z',
        access_token: 'abcdef',
        public_key: HEX130,
        nonce: 'a'.repeat(24),
      }),
    ).toBeDefined();
  });
});

describe('CLI login-role schemas', () => {
  it('CreateLoginRoleBody strict', () => {
    expect(CreateLoginRoleBody.parse({ read_only: true })).toBeDefined();
    expect(CreateLoginRoleBody.safeParse({ read_only: true, extra: 1 } as never).success).toBe(
      false,
    );
  });
  it('CreateLoginRoleResponse', () => {
    expect(
      CreateLoginRoleResponse.parse({ role: 'r', password: 'p', ttl_seconds: 300 }),
    ).toBeDefined();
    expect(
      CreateLoginRoleResponse.safeParse({ role: 'r', password: 'p', ttl_seconds: 0 }).success,
    ).toBe(false);
  });
  it('DeleteLoginRolesResponse literal', () => {
    expect(DeleteLoginRolesResponse.parse({ message: 'ok' })).toBeDefined();
    expect(DeleteLoginRolesResponse.safeParse({ message: 'nope' }).success).toBe(false);
  });
});

describe('db query/dump schemas', () => {
  it('DbQueryBodySchema strict', () => {
    expect(DbQueryBodySchema.parse({ query: 'select 1' })).toBeDefined();
    expect(DbQueryBodySchema.safeParse({ query: '' }).success).toBe(false);
    expect(DbQueryBodySchema.safeParse({ query: 's', extra: 1 } as never).success).toBe(false);
  });
  it('DbQueryResponseSchema is array of records', () => {
    expect(DbQueryResponseSchema.parse([{ a: 1 }])).toBeDefined();
    expect(DbQueryResponseSchema.safeParse([1]).success).toBe(false);
  });
  it('DbDumpBodySchema mutually exclusive', () => {
    expect(DbDumpBodySchema.parse({})).toBeDefined();
    expect(DbDumpBodySchema.parse({ schema_only: true })).toBeDefined();
    expect(
      DbDumpBodySchema.safeParse({ schema_only: true, data_only: true }).success,
    ).toBe(false);
    expect(DbDumpBodySchema.safeParse({ extra: 1 } as never).success).toBe(false);
  });
  it('DbDumpDryRunResponseSchema', () => {
    expect(
      DbDumpDryRunResponseSchema.parse({
        dry_run: true,
        bytes_estimated: 0,
        schemas_dumped: ['public'],
        duration_ms: 1,
      }),
    ).toBeDefined();
    expect(
      DbDumpDryRunResponseSchema.safeParse({
        dry_run: false,
        bytes_estimated: 0,
        schemas_dumped: [],
        duration_ms: 0,
      } as never).success,
    ).toBe(false);
  });
});
