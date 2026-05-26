/**
 * Per-project service-role JWT minter — feature 014 US5.
 *
 * Storage container REST API trusts JWTs signed with the project's `jwtSecret`
 * (HS256). Service-role tokens grant unrestricted access — used by
 * dashboard reverse-proxies that need to talk to per-project storage on the
 * operator's behalf.
 *
 * 24h TTL with an in-process cache keyed by project ref so we don't re-decrypt
 * + re-sign on every request.
 *
 * Spec: 014-mcp-http-oauth — research.md Decision 10, FR-030.
 */
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import type { InstanceSecrets } from './instance-secrets.js';

const TTL_SEC = 24 * 60 * 60; // 24h
const CACHE_HEADROOM_SEC = 60 * 60; // refresh when <1h left

interface CacheEntry {
  jwt: string;
  expiresAtMs: number;
}

const cache = new Map<string, CacheEntry>();

export class InstanceNotFoundForServiceRoleError extends Error {
  code = 'instance_not_found' as const;
}

export async function mintServiceRoleJwt(ref: string): Promise<string> {
  const now = Date.now();
  const cached = cache.get(ref);
  if (cached && cached.expiresAtMs - now > CACHE_HEADROOM_SEC * 1000) {
    return cached.jwt;
  }

  const [inst] = await db()
    .select({
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) throw new InstanceNotFoundForServiceRoleError(`instance ${ref} not found`);

  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as InstanceSecrets;
  const iat = Math.floor(now / 1000);
  const exp = iat + TTL_SEC;
  const payload = {
    role: 'service_role',
    iss: 'supabase',
    iat,
    exp,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secrets.jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url');
  const jwt = `${header}.${body}.${signature}`;
  cache.set(ref, { jwt, expiresAtMs: exp * 1000 });
  return jwt;
}

/** Test-only — flush cache. */
export function _clearServiceRoleCache(): void {
  cache.clear();
}
