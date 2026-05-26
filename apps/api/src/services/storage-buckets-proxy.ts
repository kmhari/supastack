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
import { db, schema } from '@selfbase/db';
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

export async function listBuckets(ref: string): Promise<BucketRow[]> {
  // Per-project storage container is on the project's isolated Docker network
  // (selfbase-<ref>_default). The api container can't reach it directly. Kong
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
