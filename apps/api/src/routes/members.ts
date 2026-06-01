import { createHash, randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { hashPassword } from '@supastack/crypto';
import { logger, errors, schemas } from '@supastack/shared';

const INVITE_TTL_HOURS = 24;

export const membersRoutes: FastifyPluginAsync = async (app) => {
  // ─── LIST members ────────────────────────────────────────────────────────
  app.get('/members', async (req, reply) => {
    app.authorize(req, 'member.list');
    const rows = await db()
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        role: schema.orgMembers.role,
        createdAt: schema.orgMembers.createdAt,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId))
      .orderBy(asc(schema.orgMembers.createdAt));
    return reply.send(rows);
  });

  // ─── INVITE create (admin) ───────────────────────────────────────────────
  app.post('/members/invites', async (req, reply) => {
    app.authorize(req, 'member.invite');
    const user = app.requireAuth(req);
    const body = schemas.InviteCreateRequest.parse(req.body);

    const [orgRow] = await db().select({ id: schema.org.id }).from(schema.org).limit(1);
    if (!orgRow) throw errors.notFound('org not initialized');

    // Check for an existing open (non-consumed) invite for this email.
    const existing = await db()
      .select({ id: schema.invites.id })
      .from(schema.invites)
      .where(and(eq(schema.invites.email, body.email), isNull(schema.invites.consumedAt)))
      .limit(1);
    if (existing[0]) throw errors.conflict(`an open invite already exists for ${body.email}`);

    // Also reject if email already belongs to an existing user.
    const existingUser = await db()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, body.email))
      .limit(1);
    if (existingUser[0]) throw errors.conflict(`${body.email} is already a member`);

    const rawToken = randomBytes(32).toString('hex');
    const tokenSha256 = createHash('sha256').update(rawToken, 'utf8').digest();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    const [row] = await db()
      .insert(schema.invites)
      .values({
        orgId: orgRow.id,
        email: body.email,
        tokenSha256,
        role: body.role,
        invitedByUserId: user.id,
        expiresAt,
      })
      .returning({ id: schema.invites.id });

    await db()
      .insert(schema.auditLog)
      .values({
        actorUserId: user.id,
        action: 'member.invite',
        targetKind: 'invite',
        targetId: row!.id,
        payload: { email: body.email, role: body.role },
      });

    // v1: surface the link in the API response and log it. SMTP delivery is a
    // future enhancement (org-level SMTP config).
    const apexRow = await db().select({ apex: schema.org.apexDomain }).from(schema.org).limit(1);
    const link = apexRow[0]?.apex
      ? `https://${apexRow[0].apex}/accept-invite?token=${rawToken}`
      : `/accept-invite?token=${rawToken}`;
    logger.info({ email: body.email, role: body.role }, 'invite created (link logged once)');
    logger.info({ link }, 'INVITE_LINK (visible once)');

    return reply.status(201).send({
      id: row!.id,
      email: body.email,
      role: body.role,
      link,
      expiresAt,
    });
  });

  // ─── INVITE list ─────────────────────────────────────────────────────────
  app.get('/members/invites', async (req, reply) => {
    app.authorize(req, 'member.invite'); // listing open invites is admin-only
    const rows = await db()
      .select({
        id: schema.invites.id,
        email: schema.invites.email,
        role: schema.invites.role,
        createdAt: schema.invites.createdAt,
        expiresAt: schema.invites.expiresAt,
        consumedAt: schema.invites.consumedAt,
      })
      .from(schema.invites)
      .where(isNull(schema.invites.consumedAt))
      .orderBy(asc(schema.invites.createdAt));
    return reply.send(rows);
  });

  // ─── INVITE revoke ───────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/members/invites/:id', async (req, reply) => {
    app.authorize(req, 'member.invite');
    const user = app.requireAuth(req);
    const [row] = await db()
      .select({ id: schema.invites.id, consumedAt: schema.invites.consumedAt })
      .from(schema.invites)
      .where(eq(schema.invites.id, req.params.id))
      .limit(1);
    if (!row) throw errors.notFound('invite not found');
    if (row.consumedAt) throw errors.gone('invite already accepted');
    await db().delete(schema.invites).where(eq(schema.invites.id, row.id));
    await db().insert(schema.auditLog).values({
      actorUserId: user.id,
      action: 'invite.revoke',
      targetKind: 'invite',
      targetId: row.id,
    });
    return reply.status(204).send();
  });

  // ─── INVITE accept (open — token in body) ────────────────────────────────
  app.post('/members/invites/accept', async (req, reply) => {
    const body = schemas.InviteAcceptRequest.parse(req.body);
    const sha = createHash('sha256').update(body.token, 'utf8').digest();
    const [invite] = await db()
      .select()
      .from(schema.invites)
      .where(and(eq(schema.invites.tokenSha256, sha), isNull(schema.invites.consumedAt)))
      .limit(1);
    if (!invite) throw errors.gone('invite invalid, expired, or already used');
    if (invite.expiresAt < new Date()) throw errors.gone('invite expired');

    // Belt-and-suspenders: also reject if a user with that email exists (race
    // between two acceptances for two invites issued to the same email).
    const existing = await db()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, invite.email))
      .limit(1);
    if (existing[0]) throw errors.conflict('email already registered');

    const hashed = await hashPassword(body.password);

    const result = await db().transaction(async (tx) => {
      const [u] = await tx
        .insert(schema.users)
        .values({ email: invite.email, hashedPassword: hashed })
        .returning({ id: schema.users.id });
      await tx
        .insert(schema.orgMembers)
        .values({ orgId: invite.orgId, userId: u!.id, role: invite.role });
      await tx
        .update(schema.invites)
        .set({ consumedAt: new Date() })
        .where(eq(schema.invites.id, invite.id));
      await tx.insert(schema.auditLog).values({
        actorUserId: u!.id,
        action: 'invite.accept',
        targetKind: 'user',
        targetId: u!.id,
        payload: { role: invite.role, inviteId: invite.id },
      });
      return { userId: u!.id, email: invite.email, role: invite.role };
    });

    // Auto-login so the user lands in the dashboard.
    req.session.userId = result.userId;

    return reply.status(201).send(result);
  });

  // ─── MEMBER delete (cascade tokens + sessions) ───────────────────────────
  app.delete<{ Params: { userId: string } }>('/members/:userId', async (req, reply) => {
    app.authorize(req, 'member.remove');
    const actor = app.requireAuth(req);
    if (actor.id === req.params.userId) {
      throw errors.invalidInput('cannot remove yourself; ask another admin');
    }
    const [user] = await db()
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, req.params.userId))
      .limit(1);
    if (!user) throw errors.notFound('user not found');

    // Refuse to remove the last admin.
    const remainingAdmins = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.role, 'admin'), ne(schema.orgMembers.userId, user.id)));
    if ((remainingAdmins[0]?.count ?? 0) < 1) {
      throw errors.conflict('cannot remove the last admin');
    }

    await db().transaction(async (tx) => {
      // Revoke all tokens for the user (so a held token immediately stops
      // working). CASCADE on `users` would also delete them, but we want the
      // `revoked_at` marker for audit/forensics.
      await tx
        .update(schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.apiTokens.userId, user.id), isNull(schema.apiTokens.revokedAt)));
      // Delete the user. ON DELETE CASCADE removes the orgMembers + apiTokens
      // rows; sessions live in Redis (see below).
      await tx.delete(schema.users).where(eq(schema.users.id, user.id));
      await tx.insert(schema.auditLog).values({
        actorUserId: actor.id,
        action: 'member.remove',
        targetKind: 'user',
        targetId: user.id,
        payload: { email: user.email },
      });
    });

    // Destroy any active sessions for the removed user. Sessions are stored
    // in Redis under `selfbase:sess:<sid>`. We don't have a userId→sids
    // index, so do a key scan and prune. For typical small orgs this is OK;
    // a future enhancement is to maintain a reverse index.
    try {
      const { Redis } = await import('ioredis');
      const r = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 0 });
      const stream = r.scanStream({ match: 'selfbase:sess:*', count: 100 });
      const toCheck: string[] = [];
      for await (const keys of stream) {
        for (const k of keys as string[]) toCheck.push(k);
      }
      let removed = 0;
      for (const key of toCheck) {
        const v = await r.get(key);
        if (!v) continue;
        try {
          const parsed = JSON.parse(v) as { userId?: string };
          if (parsed.userId === user.id) {
            await r.del(key);
            removed++;
          }
        } catch {
          /* ignore non-JSON values */
        }
      }
      r.disconnect();
      logger.info({ userId: user.id, sessionsRemoved: removed }, 'member-remove session cleanup');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'session cleanup on member-remove failed');
    }

    return reply.status(204).send();
  });

  // Silence "imported but never used" hints when this file is consumed via tests
  void gte;
  void lt;
};
