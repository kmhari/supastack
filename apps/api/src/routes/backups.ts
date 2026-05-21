import type { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { and, desc, eq } from 'drizzle-orm';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import { db, schema } from '@selfbase/db';
import { errors } from '@selfbase/shared';
import {
  LocalDiskStore,
  S3Store,
  type BackupStore,
  type S3StoreConfig,
} from '@selfbase/backup-store';
import { signDownloadToken, verifyDownloadToken } from '../services/download-tokens.js';

const REDIS_URL = process.env.REDIS_URL!;
const BACKUPS_DIR = process.env.BACKUPS_DIR ?? '/var/selfbase/backups';

let _q: Queue | null = null;
function backupQueue(): Queue {
  if (!_q) {
    _q = new Queue('selfbase.backup', {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }
  return _q;
}

async function resolveStore(): Promise<{ kind: 'local' | 's3'; store: BackupStore }> {
  const [row] = await db()
    .select({
      kind: schema.org.backupStoreKind,
      cfg: schema.org.backupStoreConfigEncrypted,
    })
    .from(schema.org)
    .limit(1);
  if (!row || row.kind === 'local') {
    return { kind: 'local', store: new LocalDiskStore(BACKUPS_DIR) };
  }
  if (!row.cfg) throw errors.invalidInput('s3 backup-store config missing');
  const cfg = decryptJson<S3StoreConfig>(row.cfg, loadMasterKey());
  return { kind: 's3', store: new S3Store(cfg) };
}

export const backupsRoutes: FastifyPluginAsync = async (app) => {
  // ─── LIST ────────────────────────────────────────────────────────────────
  app.get<{ Params: { ref: string } }>('/instances/:ref/backups', async (req, reply) => {
    app.authorize(req, 'backup.list');
    const rows = await db()
      .select({
        id: schema.backups.id,
        kind: schema.backups.kind,
        status: schema.backups.status,
        storeKind: schema.backups.storeKind,
        sizeBytes: schema.backups.sizeBytes,
        startedAt: schema.backups.startedAt,
        completedAt: schema.backups.completedAt,
        error: schema.backups.error,
      })
      .from(schema.backups)
      .where(eq(schema.backups.instanceRef, req.params.ref))
      .orderBy(desc(schema.backups.startedAt));
    return reply.send(
      rows.map((r) => ({
        ...r,
        downloadUrl:
          r.status === 'completed'
            ? `/api/v1/instances/${req.params.ref}/backups/${r.id}/download?t=${signDownloadToken(r.id)}`
            : null,
      })),
    );
  });

  // ─── CREATE (on-demand) ──────────────────────────────────────────────────
  app.post<{ Params: { ref: string } }>('/instances/:ref/backups', async (req, reply) => {
    app.authorize(req, 'backup.create');
    const user = app.requireAuth(req);
    const ref = req.params.ref;
    // Sanity-check the instance exists.
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, ref))
      .limit(1);
    if (!inst) throw errors.notFound(`instance ${ref} not found`);

    await db().insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'backup.create',
      targetKind: 'instance',
      targetId: ref,
    });
    await backupQueue().add('backup', { ref, kind: 'manual' }, { removeOnComplete: 100 });
    return reply.status(202).send({ status: 'running' });
  });

  // ─── DOWNLOAD ────────────────────────────────────────────────────────────
  app.get<{ Params: { ref: string; id: string }; Querystring: { t?: string } }>(
    '/instances/:ref/backups/:id/download',
    async (req, reply) => {
      app.authorize(req, 'backup.download');
      const token = req.query.t;
      if (!token || !verifyDownloadToken(token, req.params.id)) {
        throw errors.forbidden('signed download token invalid or expired');
      }
      const [row] = await db()
        .select()
        .from(schema.backups)
        .where(
          and(
            eq(schema.backups.id, req.params.id),
            eq(schema.backups.instanceRef, req.params.ref),
            eq(schema.backups.status, 'completed'),
          ),
        )
        .limit(1);
      if (!row) throw errors.notFound('backup not found');

      const { kind, store } = await resolveStore();
      if (kind === 's3' && store.signedUrl) {
        const url = await store.signedUrl(row.storeKey, 300);
        return reply.redirect(307, url);
      }
      const stream = await store.get(row.storeKey);
      void reply.header(
        'Content-Disposition',
        `attachment; filename="selfbase-${req.params.ref}-${row.id}.dump"`,
      );
      void reply.header('Content-Type', 'application/octet-stream');
      return reply.send(stream);
    },
  );
};
