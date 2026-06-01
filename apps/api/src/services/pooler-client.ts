import { fetch } from 'undici';
import crypto from 'node:crypto';
import { logger } from '@supastack/shared';

/**
 * Thin HTTP client for Supavisor's admin API (feature 005 Phase 5).
 * See contracts/tenant-registration.md.
 *
 * Tenant ops:
 *  - PUT  /api/tenants/:external_id  → create or replace
 *  - DELETE /api/tenants/:external_id → unregister
 *  - GET  /api/tenants               → list
 *
 * Auth: short-lived HS256 JWT signed with SUPAVISOR_API_JWT_SECRET.
 */

const SUPAVISOR_URL = process.env.SUPAVISOR_URL ?? 'http://supavisor:4000';
const JWT_SECRET = process.env.SUPAVISOR_API_JWT_SECRET ?? '';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mintJwt(): string {
  if (!JWT_SECRET) throw new Error('SUPAVISOR_API_JWT_SECRET not set');
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        role: 'admin',
        iss: 'selfbase',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ),
  );
  const sig = b64url(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${sig}`;
}

async function callSupavisor(
  method: 'GET' | 'PUT' | 'DELETE' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${SUPAVISOR_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${mintJwt()}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, data };
}

export interface RegisterTenantInput {
  externalId: string; // = instance ref (20 chars)
  dbHost: string; // 'host.docker.internal'
  dbPort: number; // per-instance Postgres host port (port_db_direct)
  dbDatabase: string; // 'postgres'
  dbPassword: string; // plaintext (supavisor encrypts at rest)
  sniHostname?: string; // optional; supavisor matches SNI when client provides it
  poolSize?: number; // default 20
  maxClients?: number; // default 100
}

export async function registerTenant(input: RegisterTenantInput): Promise<void> {
  const body = {
    tenant: {
      db_host: input.dbHost,
      db_port: input.dbPort,
      db_database: input.dbDatabase,
      default_pool_size: input.poolSize ?? 20,
      default_max_clients: input.maxClients ?? 100,
      require_user: false,
      auth_query: 'SELECT rolname, rolpassword FROM pg_authid WHERE rolname=$1',
      ...(input.sniHostname ? { sni_hostname: input.sniHostname } : {}),
      users: [
        {
          db_user: 'postgres',
          db_password: input.dbPassword,
          mode_type: 'transaction',
          pool_size: input.poolSize ?? 20,
          is_manager: true,
        },
      ],
    },
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { status, data } = await callSupavisor('PUT', `/api/tenants/${input.externalId}`, body);
    if (status === 200 || status === 201) {
      logger.info({ ref: input.externalId, status }, 'supavisor: tenant registered');
      return;
    }
    if (status === 409) {
      // already exists — idempotent
      logger.info(
        { ref: input.externalId },
        'supavisor: tenant already exists, treating as success',
      );
      return;
    }
    if (status >= 500) {
      lastErr = data;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }
    throw new Error(`supavisor register failed (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  throw new Error(
    `supavisor register failed after 3 attempts: ${JSON.stringify(lastErr).slice(0, 300)}`,
  );
}

export async function unregisterTenant(externalId: string): Promise<void> {
  const { status, data } = await callSupavisor('DELETE', `/api/tenants/${externalId}`);
  if (status === 200 || status === 204 || status === 404) {
    logger.info({ ref: externalId, status }, 'supavisor: tenant unregistered');
    return;
  }
  throw new Error(`supavisor unregister failed (${status}): ${JSON.stringify(data).slice(0, 300)}`);
}

export interface TenantInfo {
  external_id: string;
  db_host: string;
  db_port: number;
  default_pool_size: number;
  default_max_clients: number;
}

export async function listTenants(): Promise<TenantInfo[]> {
  const { status, data } = await callSupavisor('GET', '/api/tenants');
  if (status !== 200) throw new Error(`supavisor list failed (${status})`);
  const body = data as { data?: TenantInfo[] };
  return body.data ?? [];
}

export async function supavisorHealth(): Promise<{ status: number; ok: boolean }> {
  try {
    const res = await fetch(`${SUPAVISOR_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return { status: res.status, ok: res.ok };
  } catch {
    return { status: 0, ok: false };
  }
}
