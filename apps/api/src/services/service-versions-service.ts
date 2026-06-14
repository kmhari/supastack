/**
 * Real per-project service versions, read from the project's own compose file.
 *
 * Provision copies the supabase-template verbatim into
 * `INSTANCES_DIR/<ref>/docker-compose.yml` (see docker-control copyDir), so the
 * literal pinned image tags for THIS project live there — and reflect a
 * per-project upgrade if one happened. We parse them instead of hardcoding,
 * which is what let the old stub drift (storage showed v1.48.26 while the
 * template pinned v1.60.10).
 *
 * Used by:
 *   - GET /platform/projects/:ref/service-versions  → upstream `ServiceVersions`
 *     ({ gotrue?, postgrest?, 'supabase-postgres' }) for Studio's Infrastructure
 *     settings panel.
 *   - GET /v1/projects/:ref/services                → per-service version list.
 *
 * FALLBACK_TAGS is the last resort when the compose file can't be read (project
 * still provisioning / not on disk). A drift test keeps it equal to the template
 * pins so the fallback never goes stale.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';

/** compose service name → Docker image repository (without tag). */
export const SERVICE_IMAGE_REPO: Record<string, string> = {
  db: 'supabase/postgres',
  auth: 'supabase/gotrue',
  rest: 'postgrest/postgrest',
  realtime: 'supabase/realtime',
  storage: 'supabase/storage-api',
  meta: 'supabase/postgres-meta',
  functions: 'supabase/edge-runtime',
  kong: 'kong/kong',
  analytics: 'supabase/logflare',
  imgproxy: 'darthsim/imgproxy',
};

/** Kept in sync with infra/supabase-template/docker-compose.yml via a drift test. */
export const FALLBACK_TAGS: Record<string, string> = {
  db: '15.8.1.085',
  auth: 'v2.186.0',
  rest: 'v14.8',
  realtime: 'v2.76.5',
  storage: 'v1.60.10',
  meta: 'v0.96.3',
  functions: 'v1.74.0',
  kong: '3.9.1',
  analytics: '1.36.1',
  imgproxy: 'v3.30.1',
};

export interface ServiceVersions {
  gotrue?: string;
  postgrest?: string;
  'supabase-postgres': string;
}

function escapeRepo(repo: string): string {
  return repo.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Read the project's compose and return `{ <serviceName>: <tag> }` for every
 * known service. Missing/unreadable compose → FALLBACK_TAGS. A service whose
 * image line isn't found falls back per-service.
 */
export async function readImageTags(ref: string): Promise<Record<string, string>> {
  let compose: string;
  try {
    compose = await fs.readFile(path.join(INSTANCES_DIR, ref, 'docker-compose.yml'), 'utf8');
  } catch {
    return { ...FALLBACK_TAGS };
  }
  const out: Record<string, string> = {};
  for (const [svc, repo] of Object.entries(SERVICE_IMAGE_REPO)) {
    const m = compose.match(new RegExp(`image:\\s*${escapeRepo(repo)}:(\\S+)`));
    out[svc] = m?.[1] ?? FALLBACK_TAGS[svc] ?? '';
  }
  return out;
}

/** Upstream `ServiceVersions` shape for /platform/.../service-versions. */
export async function getServiceVersions(ref: string): Promise<ServiceVersions> {
  const tags = await readImageTags(ref);
  return {
    'supabase-postgres': tags.db || FALLBACK_TAGS.db || '',
    gotrue: tags.auth || undefined,
    postgrest: tags.rest || undefined,
  };
}

export type ServiceHealthStatus = 'COMING_UP' | 'ACTIVE_HEALTHY' | 'UNHEALTHY';

export interface ProjectService {
  name: string;
  version: string;
  status: ServiceHealthStatus;
}

export interface ProjectServicesResult {
  notFound?: true;
  services: ProjectService[];
}

// Services surfaced by GET /v1/projects/:ref/services, in display order.
const V1_SERVICES = ['db', 'auth', 'rest', 'realtime', 'storage', 'functions'] as const;
const COMING_UP_STATES = new Set(['provisioning', 'restoring']);

/** Per-service `{ name, version, status }` for GET /v1/projects/:ref/services. */
export async function getProjectServices(ref: string): Promise<ProjectServicesResult> {
  const [inst] = await db()
    .select({ status: schema.supabaseInstances.status })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) return { notFound: true, services: [] };

  const status: ServiceHealthStatus =
    inst.status === 'running'
      ? 'ACTIVE_HEALTHY'
      : COMING_UP_STATES.has(inst.status)
        ? 'COMING_UP'
        : 'UNHEALTHY';

  const tags = await readImageTags(ref);
  const services = V1_SERVICES.map((name) => ({
    name,
    version: `${SERVICE_IMAGE_REPO[name]}:${tags[name] ?? FALLBACK_TAGS[name] ?? ''}`,
    status,
  }));
  return { services };
}
