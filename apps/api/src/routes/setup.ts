import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { hashPassword } from '@supastack/crypto';
import { schemas, errors } from '@supastack/shared';
import { mintApiToken } from '../services/api-tokens.js';
import { reloadCaddy } from '../services/caddy-reload.js';

/**
 * First-time setup. Open + gated: once a super-admin exists, subsequent
 * attempts return 410. Mirrors open-frontend's pattern (apps/api/src/routes/setup.ts).
 *
 * Single transaction: create user (Argon2 hash) + org (singleton) + org_members
 * row + mark setup_state.completed_at. Optional apex registration triggers a
 * Caddy reload so the apex starts serving the dashboard.
 */
export const setupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/setup/status', async (_req, reply) => {
    const row = await db()
      .select({ completedAt: schema.setupState.completedAt })
      .from(schema.setupState)
      .where(eq(schema.setupState.id, 1))
      .limit(1);
    const completedAt = row[0]?.completedAt ?? null;
    return reply.send({ open: completedAt === null });
  });

  app.post('/setup', async (req, reply) => {
    const body = schemas.SetupRequest.parse(req.body);

    // Hash before the transaction (Argon2 is expensive — keep tx short).
    const hashed = await hashPassword(body.password);

    const result = await db().transaction(async (tx) => {
      // Re-check inside the tx to avoid TOCTOU races on simultaneous POSTs.
      const state = await tx
        .select({ completedAt: schema.setupState.completedAt })
        .from(schema.setupState)
        .where(eq(schema.setupState.id, 1))
        .limit(1);
      if (state[0]?.completedAt) {
        throw errors.setupComplete();
      }

      const [orgRow] = await tx
        .insert(schema.org)
        .values({ name: body.orgName, apexDomain: body.apexDomain ?? null })
        .returning({ id: schema.org.id });

      const [userRow] = await tx
        .insert(schema.users)
        .values({ email: body.email, hashedPassword: hashed })
        .returning({ id: schema.users.id, email: schema.users.email });

      await tx.insert(schema.orgMembers).values({
        orgId: orgRow!.id,
        userId: userRow!.id,
        role: 'admin',
      });

      await tx
        .insert(schema.setupState)
        .values({ id: 1, completedAt: sql`now()` })
        .onConflictDoUpdate({
          target: schema.setupState.id,
          set: { completedAt: sql`now()` },
        });

      await tx.insert(schema.auditLog).values({
        actorUserId: userRow!.id,
        action: 'setup.complete',
        targetKind: 'org',
        targetId: orgRow!.id,
        payload: { email: body.email },
      });

      // Mint a master API token (shown once).
      const { raw: rawToken } = await mintApiToken(tx, userRow!.id, 'master');

      return { userId: userRow!.id, orgId: orgRow!.id, email: userRow!.email, apiToken: rawToken };
    });

    // Establish session so the operator is logged in immediately.
    req.session.userId = result.userId;

    // If an apex domain was set, reload Caddy so the dashboard starts serving.
    if (body.apexDomain) {
      try {
        await reloadCaddy();
      } catch (err) {
        req.log.warn({ err }, 'caddy reload failed during setup (apex set, but Caddy unreachable)');
      }
    }

    return reply.status(201).send(result);
  });
};
