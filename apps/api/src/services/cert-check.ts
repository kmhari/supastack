import { and, eq, lt } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { db, schema } from '@selfbase/db';

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

    await db().insert(schema.auditLog).values({
      actorUserId: null,
      action: 'tls.renewal_due',
      targetKind: 'wildcard_cert',
      targetId: row.id,
      payload: { apex: row.apex, notAfter: row.notAfter?.toISOString() ?? null },
    });
  }
}

function makeConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createCertCheckQueue(redisUrl: string): Queue {
  return new Queue('cert-check', { connection: makeConnection(redisUrl) });
}

export function createCertCheckWorker(redisUrl: string): Worker {
  return new Worker(
    'cert-check',
    async () => { await runCertCheck(); },
    { connection: makeConnection(redisUrl) },
  );
}
