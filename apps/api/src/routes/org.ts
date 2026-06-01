import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { encryptJson, loadMasterKey } from '@supastack/crypto';
import { schemas, errors } from '@supastack/shared';
import { reloadCaddy } from '../services/caddy-reload.js';

export const orgRoutes: FastifyPluginAsync = async (app) => {
  app.get('/org', async (req, reply) => {
    app.authorize(req, 'org.read');
    const [row] = await db()
      .select({
        id: schema.org.id,
        name: schema.org.name,
        apexDomain: schema.org.apexDomain,
        backupStoreKind: schema.org.backupStoreKind,
      })
      .from(schema.org)
      .limit(1);
    if (!row) throw errors.notFound('org not initialized');

    const certRows = await db()
      .select({ id: schema.wildcardCerts.id })
      .from(schema.wildcardCerts)
      .where(and(eq(schema.wildcardCerts.orgId, row.id), eq(schema.wildcardCerts.status, 'issued')))
      .limit(1);

    return reply.send({ ...row, hasCert: certRows.length > 0 });
  });

  app.patch('/org', async (req, reply) => {
    app.authorize(req, 'org.update');
    const body = schemas.OrgPatchRequest.parse(req.body);
    const user = app.requireAuth(req);
    const [existing] = await db()
      .select({ id: schema.org.id, apex: schema.org.apexDomain })
      .from(schema.org)
      .limit(1);
    if (!existing) throw errors.notFound('org not initialized');

    await db()
      .update(schema.org)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.apexDomain !== undefined ? { apexDomain: body.apexDomain } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.org.id, existing.id));

    await db().insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'org.update',
      targetKind: 'org',
      targetId: existing.id,
      payload: body,
    });

    // Apex change → reload Caddy so the new hostname starts serving.
    if (body.apexDomain && body.apexDomain !== existing.apex) {
      try {
        await reloadCaddy();
      } catch (err) {
        req.log.warn({ err }, 'caddy reload after apex change failed');
      }
    }

    const [updated] = await db()
      .select({
        id: schema.org.id,
        name: schema.org.name,
        apexDomain: schema.org.apexDomain,
        backupStoreKind: schema.org.backupStoreKind,
      })
      .from(schema.org)
      .limit(1);
    return reply.send(updated);
  });

  app.put('/org/backup-store', async (req, reply) => {
    app.authorize(req, 'org.backup-store.update');
    const user = app.requireAuth(req);
    const body = schemas.BackupStoreConfig.parse(req.body);
    const [existing] = await db().select({ id: schema.org.id }).from(schema.org).limit(1);
    if (!existing) throw errors.notFound('org not initialized');

    if (body.kind === 'local') {
      await db()
        .update(schema.org)
        .set({
          backupStoreKind: 'local',
          backupStoreConfigEncrypted: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.org.id, existing.id));
    } else {
      // Encrypt the whole S3 config (including secret access key).
      const encrypted = encryptJson(body, loadMasterKey());
      await db()
        .update(schema.org)
        .set({
          backupStoreKind: 's3',
          backupStoreConfigEncrypted: encrypted,
          updatedAt: new Date(),
        })
        .where(eq(schema.org.id, existing.id));
    }

    await db()
      .insert(schema.auditLog)
      .values({
        actorUserId: user.id,
        action: 'org.backup-store.update',
        targetKind: 'org',
        targetId: existing.id,
        payload: { kind: body.kind },
      });

    return reply.send({ kind: body.kind });
  });
};
