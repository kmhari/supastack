/**
 * T023 — mgmt-api-mapping: pure selfbase→cloud entity mappers.
 * Companion to the existing tests/unit/mgmt-api-mapping.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  instanceToProject,
  instanceApiKeys,
  functionRowToFunction,
  secretRowToListEntry,
  orgToOrganization,
} from '../../../src/services/mgmt-api-mapping.js';

describe('instanceToProject', () => {
  const base = {
    ref: 'aaaaaaaaaaaaaaaaaaaa',
    name: 'My Project',
    orgId: 'org-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  it('maps running → ACTIVE_HEALTHY + region=selfbase + reuses ref for id', () => {
    expect(instanceToProject({ ...base, status: 'running' })).toEqual({
      id: base.ref,
      ref: base.ref,
      name: 'My Project',
      organization_id: 'org-1',
      region: 'selfbase',
      created_at: '2026-01-01T00:00:00.000Z',
      status: 'ACTIVE_HEALTHY',
    });
  });
  it.each([
    ['provisioning', 'COMING_UP'],
    ['paused', 'INACTIVE'],
    ['stopped', 'INACTIVE'],
    ['failed', 'UNKNOWN'],
    ['deleting', 'REMOVED'],
    ['weirdness', 'UNKNOWN'],
  ])('status %s → %s', (selfbase, cloud) => {
    expect(instanceToProject({ ...base, status: selfbase as never }).status).toBe(cloud);
  });
});

describe('instanceApiKeys', () => {
  it('returns both anon + service_role rows', () => {
    expect(instanceApiKeys({ anonKey: 'ANON', serviceRoleKey: 'SRV' })).toEqual([
      { name: 'anon', api_key: 'ANON' },
      { name: 'service_role', api_key: 'SRV' },
    ]);
  });
});

describe('functionRowToFunction', () => {
  it('maps full row with import_map_path set', () => {
    const now = new Date('2026-01-02T03:04:05Z');
    const row = {
      id: 'fn-1',
      slug: 'hello',
      name: 'Hello',
      version: 7,
      status: 'ACTIVE',
      verifyJwt: true,
      importMapPath: '/im.json',
      entrypointPath: '/index.ts',
      sha256: 'deadbeef',
      createdAt: now,
      updatedAt: now,
    } as any;
    const fn = functionRowToFunction(row);
    expect(fn.id).toBe('fn-1');
    expect(fn.slug).toBe('hello');
    expect(fn.import_map).toBe(true);
    expect(fn.entrypoint_path).toBe('/index.ts');
    expect(fn.created_at).toBe(now.getTime());
  });
  it('null import_map_path → import_map=false', () => {
    const now = new Date();
    const fn = functionRowToFunction({
      id: 'f2',
      slug: 's',
      name: 'n',
      version: 1,
      status: 'ACTIVE',
      verifyJwt: false,
      importMapPath: null,
      entrypointPath: null,
      sha256: null,
      createdAt: now,
      updatedAt: now,
    } as any);
    expect(fn.import_map).toBe(false);
    expect(fn.import_map_path).toBe(null);
    expect(fn.entrypoint_path).toBe(null);
    expect(fn.ezbr_sha256).toBe(null);
  });
});

describe('secretRowToListEntry', () => {
  it('forwards name + sha256', () => {
    expect(secretRowToListEntry({ name: 'X', valueSha256: 'sha' })).toEqual({
      name: 'X',
      value: 'sha',
    });
  });
});

describe('orgToOrganization', () => {
  it('forwards id + name', () => {
    expect(orgToOrganization({ id: 'o', name: 'Org' })).toEqual({ id: 'o', name: 'Org' });
  });
});
