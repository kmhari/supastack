/**
 * Real per-project service health probe for `GET /v1/projects/:ref/health`
 * (Supabase Management API compat — drives Studio's ServiceStatus panel).
 *
 * Replaces the always-"ACTIVE_HEALTHY" stub. For a running project each
 * requested service is probed concurrently:
 *   - db        → `select 1` over the per-instance Postgres
 *   - auth      → GoTrue `/auth/v1/health` through Kong
 *   - rest      → PostgREST root `/rest/v1/` through Kong
 *   - storage   → storage-api `/storage/v1/status` through Kong
 *   - realtime  → `/realtime/v1/api/tenants/realtime-dev/health` through Kong
 *   - functions → edge-runtime `/functions/v1/` through Kong
 *
 * Liveness rule for the HTTP probes: the upstream is healthy when Kong returns
 * any status < 500. A crashed/absent container makes Kong answer 502/503, and a
 * connect error / timeout is treated as down — so the signal reflects real
 * container state, not a fixed string. Probes carry the project's service-role
 * key so Kong's key-auth/JWT-guarded routes are reachable.
 *
 * Non-running projects short-circuit without probing: provisioning/restoring →
 * COMING_UP, everything else (paused/stopped/failed/deleting) → UNHEALTHY.
 *
 * Shape matches upstream `V1ServiceHealthResponse`: { name, status, healthy,
 * error?, info? } with status ∈ COMING_UP | ACTIVE_HEALTHY | UNHEALTHY. The
 * deprecated `healthy` boolean mirrors `status === 'ACTIVE_HEALTHY'` for
 * wire-compat with the CLI/OpenAPI.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
import type { InstanceSecrets } from './instance-secrets.js';
import { withPerInstancePg } from './per-instance-pg.js';
import { getConfig } from './runtime-config-store.js';

export const DEFAULT_HEALTH_SERVICES = ['auth', 'rest', 'realtime', 'storage', 'db'] as const;

export type HealthStatus = 'COMING_UP' | 'ACTIVE_HEALTHY' | 'UNHEALTHY';

export interface ServiceHealth {
  name: string;
  status: HealthStatus;
  /** Deprecated upstream mirror of `status === 'ACTIVE_HEALTHY'`. */
  healthy: boolean;
  error?: string;
  info?: Record<string, unknown>;
}

export interface ProjectHealthResult {
  notFound?: true;
  services: ServiceHealth[];
}

// instance.status values that mean "still starting" rather than "broken".
const COMING_UP_STATES = new Set(['provisioning', 'restoring']);

const PROBE_TIMEOUT_MS = 4000;
const DEFAULT_REST_SCHEMA = 'public,storage,graphql_public';

// Kong path probed per service (strip_path turns `/auth/v1/health` into the
// container's `/health`, etc). The realtime tenant `realtime-dev` matches the
// per-instance template's healthcheck.
const HTTP_PROBES: Record<string, string> = {
  auth: '/auth/v1/health',
  rest: '/rest/v1/',
  storage: '/storage/v1/status',
  realtime: '/realtime/v1/api/tenants/realtime-dev/health',
  functions: '/functions/v1/',
};

function kongBase(portKong: number): string {
  return process.env.TEST_KONG_BASE_URL ?? `http://host.docker.internal:${portKong}`;
}

function mk(
  name: string,
  status: HealthStatus,
  error?: string,
  info?: Record<string, unknown>,
): ServiceHealth {
  return {
    name,
    status,
    healthy: status === 'ACTIVE_HEALTHY',
    ...(error ? { error } : {}),
    ...(info ? { info } : {}),
  };
}

async function httpProbe(
  portKong: number,
  serviceKey: string,
  path: string,
  wantBody = false,
): Promise<{ ok: boolean; status?: number; body?: string }> {
  const { request } = await import('undici');
  try {
    const res = await request(`${kongBase(portKong)}${path}`, {
      method: 'GET',
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      maxRedirections: 0,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    let body: string | undefined;
    if (wantBody) {
      try {
        body = await res.body.text();
      } catch {
        /* body unreadable — liveness already known from the status code */
      }
    } else {
      // Discard so undici can release the connection.
      try {
        await res.body.dump();
      } catch {
        /* ignore */
      }
    }
    return { ok: res.statusCode < 500, status: res.statusCode, body };
  } catch {
    return { ok: false };
  }
}

async function dbProbe(ref: string): Promise<boolean> {
  try {
    await withPerInstancePg(ref, (client) => client.query('select 1'), {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

async function restSchema(ref: string): Promise<string> {
  try {
    const cfg = (await getConfig(ref, 'postgrest')) as { db_schema?: string };
    return cfg.db_schema ?? DEFAULT_REST_SCHEMA;
  } catch {
    return DEFAULT_REST_SCHEMA;
  }
}

function gotrueInfo(body?: string): Record<string, unknown> | undefined {
  if (!body) return undefined;
  try {
    const j = JSON.parse(body) as { version?: string; description?: string; name?: string };
    return {
      name: 'GoTrue',
      version: j.version ?? '',
      description: j.description ?? 'GoTrue is a user registration and authentication API',
    };
  } catch {
    return undefined;
  }
}

async function probeOne(
  ref: string,
  name: string,
  portKong: number,
  serviceKey: string,
): Promise<ServiceHealth> {
  if (name === 'db' || name === 'db_postgres_user') {
    const ok = await dbProbe(ref);
    return mk(name, ok ? 'ACTIVE_HEALTHY' : 'UNHEALTHY', ok ? undefined : 'database unreachable');
  }

  const path = HTTP_PROBES[name];
  if (!path) {
    // No dedicated probe (e.g. pooler / pg_bouncer): the project is running, so
    // report operational rather than fabricating a failure.
    return mk(name, 'ACTIVE_HEALTHY');
  }

  const r = await httpProbe(portKong, serviceKey, path, name === 'auth');
  if (!r.ok) {
    return mk(name, 'UNHEALTHY', r.status ? `upstream returned ${r.status}` : 'unreachable');
  }

  let info: Record<string, unknown> | undefined;
  if (name === 'rest') info = { db_schema: await restSchema(ref) };
  else if (name === 'auth') info = gotrueInfo(r.body);
  return mk(name, 'ACTIVE_HEALTHY', undefined, info);
}

export async function probeProjectHealth(
  ref: string,
  requested: string[],
): Promise<ProjectHealthResult> {
  const [inst] = await db()
    .select({
      status: schema.supabaseInstances.status,
      portKong: schema.supabaseInstances.portKong,
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);

  if (!inst) return { notFound: true, services: [] };

  const names = requested.length ? requested : [...DEFAULT_HEALTH_SERVICES];

  if (inst.status !== 'running') {
    const status: HealthStatus = COMING_UP_STATES.has(inst.status) ? 'COMING_UP' : 'UNHEALTHY';
    return { services: names.map((name) => mk(name, status)) };
  }

  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as InstanceSecrets;
  const services = await Promise.all(
    names.map((name) => probeOne(ref, name, inst.portKong, secrets.serviceRoleKey)),
  );
  return { services };
}
