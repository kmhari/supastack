/**
 * Dashboard secrets endpoints — session-cookie auth twin of `/v1/projects/:ref/secrets`.
 *
 *   GET    /api/v1/projects/:ref/secrets    — list (name + sha256 digest)
 *   POST   /api/v1/projects/:ref/secrets    — bulk set (array of {name, value})
 *   DELETE /api/v1/projects/:ref/secrets    — bulk delete (array of names)
 *
 * Same wire shape as the /v1 surface (FR-008 + SC-008) — delegates to the
 * shared `secret-store` service. RBAC: `instance.secrets.read` for GET,
 * `instance.secrets.write` for POST/DELETE.
 *
 * Spec: 010-secrets-management — FR-006/007/013, contracts/api-secrets-dashboard.md.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { SecretSetBodySchema } from '@selfbase/shared';
import { deleteSecrets, listSecrets, setSecrets } from '../services/secret-store.js';

const DeleteBodySchema = z.array(z.string());

export const secretsDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/api/v1/projects/:ref/secrets', async (req, reply) => {
    app.authorize(req, 'instance.secrets.read');
    app.requireAuth(req);

    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, req.params.ref))
      .limit(1);
    if (!inst) {
      return reply.status(404).send({
        error: { code: 'instance_not_found', message: `Instance ${req.params.ref} not found.` },
      });
    }

    try {
      const rows = await listSecrets(req.params.ref);
      return reply.send(rows);
    } catch (err) {
      return translateAndSend(reply, err);
    }
  });

  app.post<{ Params: { ref: string } }>('/api/v1/projects/:ref/secrets', async (req, reply) => {
    app.authorize(req, 'instance.secrets.write');
    const user = app.requireAuth(req);

    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, req.params.ref))
      .limit(1);
    if (!inst) {
      return reply.status(404).send({
        error: { code: 'instance_not_found', message: `Instance ${req.params.ref} not found.` },
      });
    }

    const parsed = SecretSetBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: {
          code: 'validation',
          message: 'Invalid request body',
          details: parsed.error.issues,
        },
      });
    }

    try {
      await setSecrets(req.params.ref, parsed.data, { userId: user.id });
      await db()
        .insert(schema.auditLog)
        .values({
          actorUserId: user.id,
          action: 'instance.secrets.set',
          targetKind: 'supabase_instance',
          targetId: req.params.ref,
          payload: { ref: req.params.ref, names: parsed.data.map((s) => s.name) },
        });
      return reply.status(201).send({ message: 'All secrets stored' });
    } catch (err) {
      return translateAndSend(reply, err);
    }
  });

  app.delete<{ Params: { ref: string } }>('/api/v1/projects/:ref/secrets', async (req, reply) => {
    app.authorize(req, 'instance.secrets.write');
    const user = app.requireAuth(req);

    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, req.params.ref))
      .limit(1);
    if (!inst) {
      return reply.status(404).send({
        error: { code: 'instance_not_found', message: `Instance ${req.params.ref} not found.` },
      });
    }

    const parsed = DeleteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(422).send({
        error: { code: 'validation', message: 'Body must be an array of secret names' },
      });
    }

    try {
      await deleteSecrets(req.params.ref, parsed.data, { userId: user.id });
      await db()
        .insert(schema.auditLog)
        .values({
          actorUserId: user.id,
          action: 'instance.secrets.delete',
          targetKind: 'supabase_instance',
          targetId: req.params.ref,
          payload: { ref: req.params.ref, names: parsed.data },
        });
      return reply.status(200).send({ message: 'Secrets removed' });
    } catch (err) {
      return translateAndSend(reply, err);
    }
  });
};

function translateAndSend(reply: import('fastify').FastifyReply, err: unknown): unknown {
  // The mgmt-api-errors plugin scopes ManagementApiError to /v1/*; for /api/v1/*
  // we translate the same shape into the dashboard envelope.
  if (err && typeof err === 'object' && 'statusCode' in err && 'code' in err) {
    const m = err as { statusCode: number; code: string; message: string; details?: unknown };
    return reply
      .status(m.statusCode)
      .send({ error: { code: m.code, message: m.message, details: m.details } });
  }
  throw err;
}
