/**
 * Contract test: cli-login-role wire shape vs upstream OpenAPI snapshot
 * (feature 012, T012).
 *
 * Strategy — the upstream `supabase` CLI binary is the consumer; if any
 * field name, type, or status code drifts from what its generated client
 * expects, the CLI breaks silently. This test pins the contract surface:
 *
 *   1. Read `specs/012-cli-login-role/contracts/upstream-openapi-snapshot.json`.
 *   2. For each path × method, assert:
 *        - the snapshot still names this path/method (otherwise upstream
 *          moved the endpoint and we need to deliberately re-snap),
 *        - the snapshot's request/response schemas still match what
 *          @selfbase/shared's Zod schemas accept.
 *   3. Assert each shared Zod schema accepts the upstream example and
 *      rejects obvious drift (the latter is implicit via `.strict()` on
 *      CreateLoginRoleBody and `z.literal('ok')` on DeleteLoginRolesResponse).
 *
 * This test is fully offline — no test database needed. It validates the
 * pinned JSON snapshot, not a live API. To detect upstream changes, the
 * operator re-runs the snapshot script periodically; when this test fails,
 * it forces a deliberate update of both the snapshot and our schemas.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CreateLoginRoleBody,
  CreateLoginRoleResponse,
  DeleteLoginRolesResponse,
} from '@selfbase/shared';

const SNAPSHOT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'specs',
  '012-cli-login-role',
  'contracts',
  'upstream-openapi-snapshot.json',
);

interface OpenApiSnapshot {
  _meta: { source: string; snapshot_date: string; feature: string; note: string };
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        responses: Record<string, { content?: { 'application/json': { schema: unknown } } }>;
        requestBody?: { content?: { 'application/json': { schema: unknown } } };
        'x-oauth-scope'?: string;
      }
    >
  >;
  components: {
    schemas: Record<
      string,
      { type: string; properties: Record<string, unknown>; required: string[] }
    >;
  };
}

function loadSnapshot(): OpenApiSnapshot {
  const raw = readFileSync(SNAPSHOT_PATH, 'utf-8');
  return JSON.parse(raw) as OpenApiSnapshot;
}

describe('cli-login-role contract vs upstream OpenAPI snapshot', () => {
  const snap = loadSnapshot();
  const loginRolePath = snap.paths['/v1/projects/{ref}/cli/login-role']!;
  const postOp = loginRolePath.post!;
  const deleteOp = loginRolePath.delete!;

  it('snapshot includes the singular cli/login-role path', () => {
    expect(loginRolePath).toBeDefined();
  });

  it('snapshot has POST + DELETE on the same path (no plural variant)', () => {
    expect(postOp).toBeDefined();
    expect(deleteOp).toBeDefined();
    expect(snap.paths['/v1/projects/{ref}/cli/login-roles']).toBeUndefined();
  });

  it('POST operationId is v1-create-login-role', () => {
    expect(postOp.operationId).toBe('v1-create-login-role');
  });

  it('DELETE operationId is v1-delete-login-roles (note the plural)', () => {
    expect(deleteOp.operationId).toBe('v1-delete-login-roles');
  });

  it('both methods require database:write OAuth scope', () => {
    expect(postOp['x-oauth-scope']).toBe('database:write');
    expect(deleteOp['x-oauth-scope']).toBe('database:write');
  });

  it('POST returns 201 on success and declares 429 rate-limit', () => {
    expect(postOp.responses['201']).toBeDefined();
    expect(postOp.responses['429']).toBeDefined();
  });

  it('DELETE returns 200 on success', () => {
    expect(deleteOp.responses['200']).toBeDefined();
  });

  // ─── Schema cross-checks ────────────────────────────────────────────────

  it('CreateRoleBody snapshot has required: ["read_only"] boolean (matches our Zod schema)', () => {
    const schema = snap.components.schemas.CreateRoleBody!;
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['read_only']);
    expect(schema.properties.read_only).toMatchObject({ type: 'boolean' });
    // Our Zod schema accepts the upstream example exactly.
    expect(() => CreateLoginRoleBody.parse({ read_only: true })).not.toThrow();
    expect(() => CreateLoginRoleBody.parse({ read_only: false })).not.toThrow();
  });

  it('CreateRoleResponse snapshot requires {role, password, ttl_seconds} (matches our Zod schema)', () => {
    const schema = snap.components.schemas.CreateRoleResponse!;
    expect([...schema.required].sort()).toEqual(['password', 'role', 'ttl_seconds']);
    expect(schema.properties.role).toMatchObject({ type: 'string', minLength: 1 });
    expect(schema.properties.password).toMatchObject({ type: 'string', minLength: 1 });
    expect(schema.properties.ttl_seconds).toMatchObject({ type: 'integer', minimum: 1 });
    // Our Zod schema accepts a fully-populated example.
    expect(() =>
      CreateLoginRoleResponse.parse({
        role: 'cli_login_postgres',
        password: 'a'.repeat(64),
        ttl_seconds: 300,
      }),
    ).not.toThrow();
  });

  it('DeleteRolesResponse snapshot enum is exactly ["ok"] (matches Zod literal)', () => {
    const schema = snap.components.schemas.DeleteRolesResponse!;
    expect(schema.required).toEqual(['message']);
    expect((schema.properties.message as { enum: string[] }).enum).toEqual(['ok']);
    // Our Zod schema accepts {message:"ok"} and rejects any other string.
    expect(() => DeleteLoginRolesResponse.parse({ message: 'ok' })).not.toThrow();
    expect(() => DeleteLoginRolesResponse.parse({ message: 'okay' })).toThrow();
  });

  // ─── Forward-compat with our chosen Zod posture ─────────────────────────

  it('CreateLoginRoleBody is strict — surprise fields are rejected (our policy, not upstream-mandated)', () => {
    expect(() => CreateLoginRoleBody.parse({ read_only: false, surprise: 1 } as never)).toThrow();
  });
});
