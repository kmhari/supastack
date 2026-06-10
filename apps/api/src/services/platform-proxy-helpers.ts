import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
import type { InstanceSecrets } from './instance-secrets.js';

export class ProxyProjectNotFoundError extends Error {
  code = 'proxy_project_not_found' as const;
  constructor(ref: string) {
    super(`Project ${ref} not found`);
  }
}

export class ProxyProjectPausedError extends Error {
  code = 'proxy_project_paused' as const;
  constructor(ref: string) {
    super(`Project ${ref} is paused`);
  }
}

export class ProxyUpstreamError extends Error {
  code = 'proxy_upstream_error' as const;
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const UNAVAILABLE_STATUSES = new Set(['paused', 'stopped', 'deleting']);

export interface InstanceProxy {
  portKong: number;
  dashboardPassword: string;
  serviceRoleKey: string;
  logflarePrivateAccessToken: string;
}

export async function resolveKongPort(ref: string): Promise<number> {
  const info = await resolveInstance(ref);
  return info.portKong;
}

export async function resolveInstance(ref: string): Promise<InstanceProxy> {
  const [row] = await db()
    .select({
      portKong: schema.supabaseInstances.portKong,
      status: schema.supabaseInstances.status,
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);

  if (!row) throw new ProxyProjectNotFoundError(ref);
  if (UNAVAILABLE_STATUSES.has(row.status)) throw new ProxyProjectPausedError(ref);

  const secrets = decryptJson(row.encryptedSecrets, loadMasterKey()) as InstanceSecrets;
  return {
    portKong: row.portKong,
    dashboardPassword: secrets.dashboardPassword,
    serviceRoleKey: secrets.serviceRoleKey,
    logflarePrivateAccessToken: secrets.logflarePrivateAccessToken,
  };
}

const STRIPPED_REQUEST_HEADERS = new Set(['x-connection-encrypted', 'host']);
const STRIPPED_RESPONSE_HEADERS = new Set([
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
  'access-control-expose-headers',
]);

export async function proxyToKong(
  portKong: number,
  upstreamPath: string,
  method: string,
  incomingHeaders: Record<string, string | string[] | undefined>,
  body: Buffer | null,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const { request } = await import('undici');

  const forwardHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(incomingHeaders)) {
    const key = k.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(key)) continue;
    if (v === undefined) continue;
    forwardHeaders[key] = Array.isArray(v) ? v.join(', ') : v;
  }

  const base = process.env.TEST_KONG_BASE_URL ?? `http://host.docker.internal:${portKong}`;
  const url = `${base}${upstreamPath}`;

  let res: Awaited<ReturnType<typeof request>>;
  try {
    res = await request(url, {
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
      headers: forwardHeaders,
      body: body && body.length > 0 ? body : null,
      maxRedirections: 0,
    });
  } catch (err) {
    throw new ProxyUpstreamError(`Upstream unreachable: ${(err as Error).message}`, 502);
  }

  const responseHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    const key = k.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(key)) continue;
    if (v === undefined) continue;
    responseHeaders[key] = Array.isArray(v) ? v.join(', ') : v;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of res.body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  const responseBody = Buffer.concat(chunks);

  return { status: res.statusCode, headers: responseHeaders, body: responseBody };
}
