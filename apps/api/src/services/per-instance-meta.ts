import { fetch } from 'undici';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import type { InstanceSecrets } from './instance-secrets.js';

/**
 * Shared helper that calls the per-instance `pg-meta` container via the
 * project's Kong gateway. Kong already proxies `/pg/*` → `pg-meta:8080/*`
 * with `key-auth + ACL=admin` (see infra/supabase-template/volumes/api/kong.yml),
 * so we authenticate with the project's service_role key.
 *
 * No new host port mapping is needed — the api container reaches Kong via
 * `host.docker.internal:<port_kong>` (same channel everything else uses).
 */
export interface InstanceRow {
  ref: string;
  status: string;
  portKong: number;
  encryptedSecrets: Buffer;
}

export class PerInstanceMetaError extends Error {
  constructor(
    public readonly code: 'instance_not_running' | 'meta_upstream_error' | 'meta_unreachable',
    message: string,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'PerInstanceMetaError';
  }
}

/**
 * Call `pg-meta` at `/<path>` for the given instance and return the raw
 * response (caller handles parsing). Throws PerInstanceMetaError on
 * upstream errors so callers can map to HTTP status codes.
 *
 * `path` is the path *under* pg-meta, e.g. `/types/typescript?included_schemas=public`.
 * It's appended to Kong's `/pg/` prefix.
 */
export async function callPerInstanceMeta(
  inst: InstanceRow,
  path: string,
): Promise<{ status: number; body: string; headers: Headers }> {
  if (inst.status !== 'running') {
    throw new PerInstanceMetaError(
      'instance_not_running',
      `Project is in state '${inst.status}' — cannot introspect`,
    );
  }
  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as InstanceSecrets;

  // Kong strips the /pg/ prefix → pg-meta sees `/<path>`.
  // Normalize path to start with /.
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `http://host.docker.internal:${inst.portKong}/pg${normalizedPath}`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        apikey: secrets.serviceRoleKey,
        Authorization: `Bearer ${secrets.serviceRoleKey}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new PerInstanceMetaError(
      'meta_unreachable',
      `pg-meta unreachable for ref=${inst.ref}: ${(err as Error).message}`,
    );
  }

  const body = await res.text();
  if (!res.ok) {
    throw new PerInstanceMetaError(
      'meta_upstream_error',
      `pg-meta returned ${res.status}: ${body.slice(0, 200)}`,
      res.status,
    );
  }
  return { status: res.status, body, headers: res.headers as unknown as Headers };
}
