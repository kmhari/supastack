import { and, eq, not, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { db, schema } from '@selfbase/db';
import { logger } from '@selfbase/shared';

// Tiny per-process LRU. 60-second TTL absorbs cert-renewal storms.
const cache = new Map<string, { allowed: boolean; expires: number }>();
const TTL_MS = 60_000;

/**
 * `GET /internal/tls/ask?domain=<host>` — called by Caddy before it issues a
 * cert for any hostname. Returns 200 if the host is admissible, 404 otherwise.
 *
 * Admissible:
 *  - host equals the configured apex domain
 *  - host equals `<ref>.<apex>` (data plane) for any non-deleted instance
 *  - host equals `studio-<ref>.<apex>` (Studio UI) for any non-deleted instance
 *
 * Authentication: none. This endpoint is only reachable from inside the
 * Docker network (Caddy admin :2019 is also internal-only). If you expose
 * it publicly, you've misconfigured the stack.
 */
export const tlsAskRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { domain?: string } }>('/internal/tls/ask', async (req, reply) => {
    const domain = req.query.domain?.toLowerCase()?.trim();
    if (!domain) return reply.status(404).send();

    const cached = cache.get(domain);
    if (cached && cached.expires > Date.now()) {
      return reply.status(cached.allowed ? 200 : 404).send();
    }

    const allowed = await isAdmissible(domain);
    cache.set(domain, { allowed, expires: Date.now() + TTL_MS });

    if (!allowed) {
      logger.info({ domain }, 'tls-ask deny');
    }
    return reply.status(allowed ? 200 : 404).send();
  });
};

async function isAdmissible(domain: string): Promise<boolean> {
  const orgRow = await db().select({ apex: schema.org.apexDomain }).from(schema.org).limit(1);
  const apex = orgRow[0]?.apex;
  if (!apex) return false;

  if (domain === apex) return true;

  // <ref>.<apex> (data plane) or studio-<ref>.<apex> (Studio UI)
  const suffix = `.${apex}`;
  if (!domain.endsWith(suffix)) return false;
  const left = domain.slice(0, -suffix.length);
  const m = left.match(/^(?:studio-)?([a-z0-9]{20})$/);
  if (!m || !m[1]) return false;
  const ref = m[1];

  const inst = await db()
    .select({ status: schema.supabaseInstances.status })
    .from(schema.supabaseInstances)
    .where(
      and(
        eq(schema.supabaseInstances.ref, ref),
        not(inArray(schema.supabaseInstances.status, ['deleting'])),
      ),
    )
    .limit(1);

  return inst.length > 0;
}

/** Test-only helper. */
export function _clearTlsAskCache(): void {
  cache.clear();
}
