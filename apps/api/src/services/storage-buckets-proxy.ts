/**
 * Per-project storage container reverse-proxy — feature 014 US5.
 *
 * Forwards GET requests to the project's storage container's /bucket
 * endpoint with a freshly-minted (cached) per-project service-role JWT.
 * Returns the storage container's native bare-array response.
 *
 * Spec: 014-mcp-http-oauth — FR-029..032, contracts/storage-buckets-endpoint.md.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { mintServiceRoleJwt } from './service-role-jwt.js';

export class StorageUnreachableError extends Error {
  code = 'storage_unreachable' as const;
  constructor(message: string) {
    super(message);
  }
}
export class StorageBadGatewayError extends Error {
  code = 'storage_bad_gateway' as const;
  constructor(message: string) {
    super(message);
  }
}

export interface BucketRow {
  id: string;
  name: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

async function storageFetch(
  ref: string,
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const [inst] = await db()
    .select({ portKong: schema.supabaseInstances.portKong })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) throw new StorageUnreachableError(`instance ${ref} not found in DB`);
  const jwt = await mintServiceRoleJwt(ref);
  const url = `http://host.docker.internal:${inst.portKong}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new StorageUnreachableError((err as Error).message);
  }
  const text = await res.text().catch(() => '');
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* leave as string */
  }
  return { status: res.status, data };
}

export interface CreateBucketBody {
  id?: string;
  name?: string;
  public?: boolean;
  file_size_limit?: number | null;
  allowed_mime_types?: string[] | null;
  [k: string]: unknown;
}

export async function listBuckets(ref: string): Promise<BucketRow[]> {
  // Per-project storage container is on the project's isolated Docker network
  // (supastack-<ref>_default). The api container can't reach it directly. Kong
  // (which IS host-mapped) routes `/storage/v1/*` → `storage:5000/*` on the
  // per-project network. Round-trip via Kong using the host-mapped Kong port.
  const [inst] = await db()
    .select({ portKong: schema.supabaseInstances.portKong })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) {
    throw new StorageUnreachableError(`instance ${ref} not found in DB`);
  }
  const jwt = await mintServiceRoleJwt(ref);
  const url = `http://host.docker.internal:${inst.portKong}/storage/v1/bucket`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new StorageUnreachableError((err as Error).message);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new StorageUnreachableError(`storage returned ${res.status}: ${body.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    throw new StorageBadGatewayError(`storage returned invalid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new StorageBadGatewayError('storage returned non-array body');
  }
  return parsed as BucketRow[];
}

export async function createBucket(ref: string, body: CreateBucketBody): Promise<unknown> {
  // Studio sends {id, public, ...} without `name`; storage-api requires `name`.
  const upstream = { ...body };
  if (!upstream.name && upstream.id) upstream.name = upstream.id as string;
  const r = await storageFetch(ref, '/storage/v1/bucket', 'POST', upstream);
  if (r.status >= 400)
    throw new StorageUnreachableError(
      `storage bucket create ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`,
    );
  return r.data;
}

export async function getBucket(ref: string, id: string): Promise<BucketRow> {
  const r = await storageFetch(ref, `/storage/v1/bucket/${id}`, 'GET');
  if (r.status === 404) throw new StorageUnreachableError(`bucket not found: ${id}`);
  if (r.status >= 400) throw new StorageUnreachableError(`storage bucket get ${r.status}`);
  return r.data as BucketRow;
}

export async function updateBucket(
  ref: string,
  id: string,
  body: Partial<CreateBucketBody>,
): Promise<unknown> {
  const r = await storageFetch(ref, `/storage/v1/bucket/${id}`, 'PUT', body);
  if (r.status >= 400)
    throw new StorageUnreachableError(
      `storage bucket update ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`,
    );
  return r.data;
}

export async function deleteBucket(ref: string, id: string): Promise<unknown> {
  const r = await storageFetch(ref, `/storage/v1/bucket/${id}`, 'DELETE');
  if (r.status >= 400)
    throw new StorageUnreachableError(
      `storage bucket delete ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`,
    );
  return r.data;
}

export async function emptyBucket(ref: string, id: string): Promise<unknown> {
  const r = await storageFetch(ref, `/storage/v1/bucket/${id}/empty`, 'POST', {});
  if (r.status >= 400) throw new StorageUnreachableError(`storage bucket empty ${r.status}`);
  return r.data;
}
