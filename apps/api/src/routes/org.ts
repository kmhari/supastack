import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { encryptJson, loadMasterKey } from '@supastack/crypto';
import { schemas, errors } from '@supastack/shared';
import { reloadCaddy } from '../services/caddy-reload.js';

// Feature 084 — /org now manages INSTALLATION settings (apex domain + backup
// store), which were split out of the old `org` singleton. Tenant organizations
// (name, members) live under /platform/organizations. The `installation` row is
// the singleton id = 1.
const INSTALLATION_ID = 1;

export const orgRoutes: FastifyPluginAsync = async (app) => {
  app.get('/org', async (req, reply) => {
    app.authorize(req, 'org.read');
    const [row] = await db()
      .select({
        apexDomain: schema.installation.apexDomain,
        backupStoreKind: schema.installation.backupStoreKind,
      })
      .from(schema.installation)
      .limit(1);
    if (!row) throw errors.notFound('installation not initialized');

    const certRows = await db()
      .select({ id: schema.wildcardCerts.id })
      .from(schema.wildcardCerts)
      .where(eq(schema.wildcardCerts.status, 'issued'))
      .limit(1);

    return reply.send({ ...row, hasCert: certRows.length > 0 });
  });

  app.patch('/org', async (req, reply) => {
    app.authorize(req, 'org.update');
    const body = schemas.OrgPatchRequest.parse(req.body);
    const user = app.requireAuth(req);
    const [existing] = await db()
      .select({ apex: schema.installation.apexDomain })
      .from(schema.installation)
      .limit(1);
    if (!existing) throw errors.notFound('installation not initialized');

    if (body.apexDomain !== undefined) {
      await db()
        .update(schema.installation)
        .set({ apexDomain: body.apexDomain, updatedAt: new Date() })
        .where(eq(schema.installation.id, INSTALLATION_ID));
    }

    await db().insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'org.update',
      targetKind: 'installation',
      targetId: 'installation',
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
        apexDomain: schema.installation.apexDomain,
        backupStoreKind: schema.installation.backupStoreKind,
      })
      .from(schema.installation)
      .limit(1);
    return reply.send(updated);
  });

  app.put('/org/backup-store', async (req, reply) => {
    app.authorize(req, 'org.backup-store.update');
    const user = app.requireAuth(req);
    const body = schemas.BackupStoreConfig.parse(req.body);

    if (body.kind === 'local') {
      await db()
        .update(schema.installation)
        .set({ backupStoreKind: 'local', backupStoreConfigEncrypted: null, updatedAt: new Date() })
        .where(eq(schema.installation.id, INSTALLATION_ID));
    } else {
      const encrypted = encryptJson(body, loadMasterKey());
      await db()
        .update(schema.installation)
        .set({ backupStoreKind: 's3', backupStoreConfigEncrypted: encrypted, updatedAt: new Date() })
        .where(eq(schema.installation.id, INSTALLATION_ID));
    }

    await db()
      .insert(schema.auditLog)
      .values({
        actorUserId: user.id,
        action: 'org.backup-store.update',
        targetKind: 'installation',
        targetId: 'installation',
        payload: { kind: body.kind },
      });

    return reply.send({ kind: body.kind });
  });
};
