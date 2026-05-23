import { logger } from '@selfbase/shared';

const API_URL = process.env.SELFBASE_API_URL ?? 'http://api:3001';

/**
 * Worker job that triggers per-project cert issuance via the api's internal
 * endpoint. The acme client + challenge token map MUST live in the api
 * process (because the Fastify route at /.well-known/acme-challenge/:token
 * reads from the same in-memory map). The worker just calls the api.
 *
 * Retried by BullMQ on failure (3 attempts with exponential backoff).
 */
export async function handlePgEdgeCertIssue(data: { ref: string }): Promise<void> {
  const { ref } = data;
  logger.info({ ref }, 'pg-edge-cert-issue: triggering api');
  const res = await fetch(`${API_URL}/internal/pg-edge-cert/issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`pg-edge-cert-issue api ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = (await res.json()) as { hostname: string; notAfter: string };
  logger.info({ ref, hostname: body.hostname, notAfter: body.notAfter }, 'pg-edge cert issued');
}
