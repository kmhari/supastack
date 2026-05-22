import { describe, expect, it } from 'vitest';
import {
  ApiKeySchema,
  FunctionSchema,
  OrganizationSchema,
  ProjectSchema,
  SecretListEntrySchema,
} from '@selfbase/shared';
import {
  functionRowToFunction,
  instanceApiKeys,
  instanceToProject,
  orgToOrganization,
  secretRowToListEntry,
} from '../../src/services/mgmt-api-mapping.js';

/**
 * T003a (e): selfbase entity → cloud-API shape mappers.
 *
 * Each mapper transforms one of selfbase's internal entities into the JSON
 * shape the upstream Supabase CLI expects. The OpenAPI contract is in
 * specs/003-supabase-cli-compat-p0/contracts/management-api.yaml; the Zod
 * schemas in @selfbase/shared mirror it. These tests assert that for a
 * representative fixture entity, the mapper output passes the corresponding
 * Zod schema — catching field-name drift or shape regressions cheaply.
 */
describe('instanceToProject', () => {
  it('maps a supabase_instances row to the cloud Project shape', () => {
    const row = {
      ref: 'abcdefghijklmnopqrst',
      name: 'My App',
      orgId: 'org-uuid-1',
      status: 'running',
      createdAt: new Date('2026-05-22T10:00:00Z'),
    };
    const project = instanceToProject(row as any);
    expect(() => ProjectSchema.parse(project)).not.toThrow();
    expect(project.ref).toBe('abcdefghijklmnopqrst');
    expect(project.organization_id).toBe('org-uuid-1');
    expect(project.region).toBe('selfbase'); // synthetic — selfbase has no AWS region
  });
});

describe('instanceApiKeys', () => {
  it('maps decrypted instance secrets to [{name:anon, api_key}, {name:service_role, api_key}]', () => {
    const secrets = {
      anonKey: 'eyJhbGc.fake-anon-jwt',
      serviceRoleKey: 'eyJhbGc.fake-service-role-jwt',
    } as any;
    const keys = instanceApiKeys(secrets);
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.name)).toEqual(['anon', 'service_role']);
    for (const k of keys) {
      expect(() => ApiKeySchema.parse(k)).not.toThrow();
    }
  });
});

describe('functionRowToFunction', () => {
  it('maps a project_functions row to the cloud Function shape with epoch-ms timestamps', () => {
    const row = {
      id: 'fn-uuid',
      slug: 'hello',
      name: 'hello',
      status: 'ACTIVE',
      version: 1,
      verifyJwt: true,
      entrypointPath: 'supabase/functions/hello/index.ts',
      importMapPath: null,
      sha256: 'abc123',
      createdAt: new Date('2026-05-22T10:00:00Z'),
      updatedAt: new Date('2026-05-22T11:00:00Z'),
    };
    const fn = functionRowToFunction(row as any);
    expect(() => FunctionSchema.parse(fn)).not.toThrow();
    expect(fn.created_at).toBe(new Date('2026-05-22T10:00:00Z').getTime());
    expect(fn.ezbr_sha256).toBe('abc123');
  });
});

describe('secretRowToListEntry', () => {
  it('returns {name, value} where value is the SHA-256 of the plaintext (redacted)', () => {
    const row = {
      name: 'STRIPE_KEY',
      // plaintext: 'sk_test_123' → sha256 hex digest
      valueSha256: 'a4b1c2d3e4f5...', // pretend digest
    };
    const entry = secretRowToListEntry(row as any);
    expect(() => SecretListEntrySchema.parse(entry)).not.toThrow();
    expect(entry.name).toBe('STRIPE_KEY');
    expect(entry.value).toBe('a4b1c2d3e4f5...');
    // Critical: plaintext MUST NOT appear in list responses.
    expect(JSON.stringify(entry)).not.toContain('sk_test');
  });
});

describe('orgToOrganization', () => {
  it('maps an organizations row to the cloud Organization shape', () => {
    const row = { id: 'org-uuid-1', name: 'Acme Co' };
    const org = orgToOrganization(row as any);
    expect(() => OrganizationSchema.parse(org)).not.toThrow();
    expect(org).toEqual({ id: 'org-uuid-1', name: 'Acme Co' });
  });
});
