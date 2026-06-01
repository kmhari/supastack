/**
 * Pure mappers from supastack entities to the cloud Supabase Management API
 * response shapes. No I/O, no Fastify imports — safe to unit-test (T003a).
 *
 * Spec: specs/003-supabase-cli-compat-p0/data-model.md ↔
 *       specs/003-supabase-cli-compat-p0/contracts/management-api.yaml
 */
import type { schema } from '@supastack/db';
import type {
  ApiKey,
  FunctionRecord,
  Organization,
  Project,
  SecretListEntry,
} from '@supastack/shared';
import type { InstanceSecrets } from './instance-secrets.js';

type InstanceRow = typeof schema.supabaseInstances.$inferSelect;
type OrgRow = typeof schema.org.$inferSelect;
type FunctionRow = typeof schema.projectFunctions.$inferSelect;
type SecretRow = typeof schema.projectSecrets.$inferSelect;

/**
 * Synthetic region label. Supastack doesn't model AWS regions; the cloud CLI
 * uses `region` only for display in `supabase projects list` and a few
 * status views, so any stable string suffices.
 */
const SUPASTACK_REGION = 'supastack';

const STATUS_MAP: Record<string, Project['status']> = {
  running: 'ACTIVE_HEALTHY',
  provisioning: 'COMING_UP',
  paused: 'INACTIVE',
  stopped: 'INACTIVE',
  failed: 'UNKNOWN',
  deleting: 'REMOVED',
};

export function instanceToProject(
  row: Pick<InstanceRow, 'ref' | 'name' | 'orgId' | 'status' | 'createdAt'>,
): Project {
  return {
    id: row.ref, // cloud uses uuid `id` distinct from short `ref`; supastack has only `ref`, reuse
    ref: row.ref,
    name: row.name,
    organization_id: row.orgId,
    region: SUPASTACK_REGION,
    created_at: row.createdAt.toISOString(),
    status: STATUS_MAP[row.status] ?? 'UNKNOWN',
  };
}

export function instanceApiKeys(
  secrets: Pick<InstanceSecrets, 'anonKey' | 'serviceRoleKey'>,
): ApiKey[] {
  return [
    { name: 'anon', api_key: secrets.anonKey },
    { name: 'service_role', api_key: secrets.serviceRoleKey },
  ];
}

export function functionRowToFunction(row: FunctionRow): FunctionRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    version: row.version,
    status: row.status,
    verify_jwt: row.verifyJwt,
    import_map: Boolean(row.importMapPath),
    entrypoint_path: row.entrypointPath ?? null,
    import_map_path: row.importMapPath ?? null,
    ezbr_sha256: row.sha256 ?? null,
    created_at: row.createdAt.getTime(),
    updated_at: row.updatedAt.getTime(),
  };
}

export function secretRowToListEntry(
  row: Pick<SecretRow, 'name' | 'valueSha256'>,
): SecretListEntry {
  return {
    name: row.name,
    value: row.valueSha256,
  };
}

export function orgToOrganization(row: Pick<OrgRow, 'id' | 'name'>): Organization {
  return { id: row.id, name: row.name };
}
