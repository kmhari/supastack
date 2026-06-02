import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { schemas, errors } from '@supastack/shared';
import { mintApiToken } from '../services/api-tokens.js';

// Feature 084 — login/logout moved to the real GoTrue at /auth/v1/{token,logout}.
// This route keeps /auth/me (identity echo) + PAT (sbp_) management only.
export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auth/me', async (req, reply) => {
    const user = app.requireAuth(req);
    return reply.send({ userId: user.id, email: user.email, role: user.role });
  });

  // ─── tokens (per-user) ────────────────────────────────────────────────────
  app.post('/auth/tokens', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = schemas.TokenCreateRequest.parse(req.body);
    const { raw, id } = await mintApiToken(db(), user.id, body.label);
    await db()
      .insert(schema.auditLog)
      .values({
        actorUserId: user.id,
        action: 'token.create',
        targetKind: 'token',
        targetId: id,
        payload: { label: body.label },
      });
    return reply.status(201).send({ id, label: body.label, token: raw });
  });

  app.get('/auth/tokens', async (req, reply) => {
    const user = app.requireAuth(req);
    const rows = await db()
      .select({
        id: schema.apiTokens.id,
        label: schema.apiTokens.label,
        prefix: schema.apiTokens.prefix,
        source: schema.apiTokens.source, // feature 011 — distinguishes 'cli' from 'manual'
        lastUsedAt: schema.apiTokens.lastUsedAt,
        createdAt: schema.apiTokens.createdAt,
      })
      .from(schema.apiTokens)
      .where(and(eq(schema.apiTokens.userId, user.id), isNull(schema.apiTokens.revokedAt)))
      .orderBy(desc(schema.apiTokens.createdAt));
    return reply.send(rows);
  });

  app.delete<{ Params: { id: string } }>('/auth/tokens/:id', async (req, reply) => {
    const user = app.requireAuth(req);
    const id = req.params.id;
    // Only allow revoking own tokens (FR-005).
    const [row] = await db()
      .select({ userId: schema.apiTokens.userId })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.id, id))
      .limit(1);
    if (!row) throw errors.notFound('token not found');
    if (row.userId !== user.id) throw errors.forbidden();
    await db()
      .update(schema.apiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiTokens.id, id));
    await db().insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'token.revoke',
      targetKind: 'token',
      targetId: id,
    });
    return reply.status(204).send();
  });
};
