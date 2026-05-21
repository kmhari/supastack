import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';

interface ListQuery {
  action?: string;
  actor?: string;
  since?: string;
  until?: string;
  limit?: string;
  cursor?: string;
}

const MAX_LIMIT = 200;

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>('/audit', async (req, reply) => {
    app.authorize(req, 'audit.read');
    const q = req.query;
    const limit = Math.min(Number(q.limit ?? 50) || 50, MAX_LIMIT);

    const conditions: SQL[] = [];
    if (q.action) conditions.push(eq(schema.auditLog.action, q.action));
    if (q.actor) conditions.push(eq(schema.auditLog.actorUserId, q.actor));
    if (q.since) conditions.push(gte(schema.auditLog.createdAt, new Date(q.since)));
    if (q.until) conditions.push(lte(schema.auditLog.createdAt, new Date(q.until)));
    if (q.cursor) {
      const cursorId = Number(q.cursor);
      if (Number.isFinite(cursorId)) conditions.push(lt(schema.auditLog.id, cursorId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db()
      .select({
        id: schema.auditLog.id,
        actorUserId: schema.auditLog.actorUserId,
        actorEmail: schema.users.email,
        action: schema.auditLog.action,
        targetKind: schema.auditLog.targetKind,
        targetId: schema.auditLog.targetId,
        payload: schema.auditLog.payload,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorUserId))
      .where(where)
      .orderBy(desc(schema.auditLog.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const entries = rows.slice(0, limit);
    const nextCursor =
      hasMore && entries.length > 0 ? String(entries[entries.length - 1]!.id) : null;
    return reply.send({ entries, nextCursor });
  });
};
