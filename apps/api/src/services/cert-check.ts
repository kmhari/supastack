import { and, eq, lt } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { db, schema } from '@supastack/db';
import { QUEUES } from '@supastack/shared';

const RENEWAL_WINDOW_DAYS = 30;

export async function runCertCheck(): Promise<void> {
  const cutoff = new Date(Date.now() + RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db()
    .select({
      id: schema.wildcardCerts.id,
      orgId: schema.wildcardCerts.orgId,
      apex: schema.wildcardCerts.apex,
      notAfter: schema.wildcardCerts.notAfter,
    })
    .from(schema.wildcardCerts)
    .where(
      and(
        eq(schema.wildcardCerts.status, 'issued'),
        eq(schema.wildcardCerts.renewalDue, false),
        lt(schema.wildcardCerts.notAfter, cutoff),
      ),
    );

  for (const row of rows) {
    await db()
      .update(schema.wildcardCerts)
      .set({ renewalDue: true, updatedAt: new Date() })
      .where(eq(schema.wildcardCerts.id, row.id));

    await db()
      .insert(schema.auditLog)
      .values({
        actorUserId: null,
        action: 'tls.renewal_due',
        targetKind: 'wildcard_cert',
        targetId: row.id,
        payload: { apex: row.apex, notAfter: row.notAfter?.toISOString() ?? null },
      });
  }

  // Per-project pg-edge certs (feature 005 Option B). Enqueue re-issuance for
  // any cert within the renewal window.
  const edgeRows = await db()
    .select({
      id: schema.pgEdgeCerts.id,
      instanceRef: schema.pgEdgeCerts.instanceRef,
      hostname: schema.pgEdgeCerts.hostname,
      notAfter: schema.pgEdgeCerts.notAfter,
    })
    .from(schema.pgEdgeCerts)
    .where(and(eq(schema.pgEdgeCerts.status, 'issued'), lt(schema.pgEdgeCerts.notAfter, cutoff)));

  if (edgeRows.length > 0) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const queue = new Queue(QUEUES.pgEdgeCertIssue, {
        connection: makeConnection(redisUrl),
      });
      for (const row of edgeRows) {
        await queue.add(
          'renew',
          { ref: row.instanceRef },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 50,
            removeOnFail: 50,
          },
        );
        await db()
          .insert(schema.auditLog)
          .values({
            actorUserId: null,
            action: 'tls.pg_edge.renewal_enqueued',
            targetKind: 'pg_edge_cert',
            targetId: row.id,
            payload: { hostname: row.hostname, notAfter: row.notAfter?.toISOString() ?? null },
          });
      }
      await queue.close();
    }
  }
}

function makeConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createCertCheckQueue(redisUrl: string): Queue {
  return new Queue(QUEUES.certCheck, { connection: makeConnection(redisUrl) });
}

export function createCertCheckWorker(redisUrl: string): Worker {
  return new Worker(
    QUEUES.certCheck,
    async () => {
      await runCertCheck();
    },
    { connection: makeConnection(redisUrl) },
  );
}
