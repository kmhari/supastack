import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { schemas, errors } from '@supastack/shared';
import { mintApiToken } from '../services/api-tokens.js';
import { createOrganizationWithOwner } from '../services/org-store.js';
import { reloadCaddy } from '../services/caddy-reload.js';
import { ensureGotrueUser } from '../services/gotrue-admin.js';

/**
 * First-time setup. Open + gated: once setup is complete, subsequent attempts
 * return 410.
 *
 * Feature 084 — the first operator is created in GoTrue (the identity source);
 * supastack stores the `installation` singleton (apex + backups), the first
 * `organizations` row (20-char ref), and an owner membership keyed by the
 * GoTrue user id. No local password hashing, no session.
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

    // Refuse early if setup already ran (the tx re-checks for the race).
    const pre = await db()
      .select({ completedAt: schema.setupState.completedAt })
      .from(schema.setupState)
      .where(eq(schema.setupState.id, 1))
      .limit(1);
    if (pre[0]?.completedAt) throw errors.setupComplete();

    // Create (idempotently) the first operator in GoTrue — the SOLE identity
    // source. No local users-table write happens anywhere in setup: `schema.users`
    // IS `auth.users` (GoTrue-owned); supastack only stores the org + membership.
    const operator = await ensureGotrueUser({
      email: body.email,
      password: body.password,
      emailConfirm: true,
    });

    const result = await db().transaction(async (tx) => {
      const state = await tx
        .select({ completedAt: schema.setupState.completedAt })
        .from(schema.setupState)
        .where(eq(schema.setupState.id, 1))
        .limit(1);
      if (state[0]?.completedAt) throw errors.setupComplete();

      // Installation singleton (apex + backups).
      await tx
        .insert(schema.installation)
        .values({ id: 1, apexDomain: body.apexDomain ?? null })
        .onConflictDoUpdate({
          target: schema.installation.id,
          set: { apexDomain: body.apexDomain ?? null, updatedAt: new Date() },
        });

      // First tenant organization + owner membership via the shared primitive
      // (feature 086 — same implementation as POST /platform/organizations).
      // Runs inside this tx so the org commits atomically with installation +
      // setup_state + the master PAT. The operator id comes from GoTrue (above).
      const { id: orgId } = await createOrganizationWithOwner(tx, {
        userId: operator.id,
        name: body.orgName,
      });

      // Claim any ownerless orgs (e.g. the "Legacy (pre-084)" org that holds
      // projects migrated from the old singleton) so the first operator can see
      // and manage them.
      await tx.execute(sql`
        INSERT INTO organization_members (organization_id, user_id, role)
        SELECT o.id, ${operator.id}, 'owner'
        FROM organizations o
        WHERE NOT EXISTS (
          SELECT 1 FROM organization_members m WHERE m.organization_id = o.id
        )
      `);

      await tx
        .insert(schema.setupState)
        .values({ id: 1, completedAt: sql`now()` })
        .onConflictDoUpdate({
          target: schema.setupState.id,
          set: { completedAt: sql`now()` },
        });

      await tx.insert(schema.auditLog).values({
        actorUserId: operator.id,
        action: 'setup.complete',
        targetKind: 'org',
        targetId: orgId,
        payload: { email: body.email },
      });

      // Mint a master API token (shown once).
      const { raw: rawToken } = await mintApiToken(tx, operator.id, 'master');

      return { userId: operator.id, orgId, email: operator.email, apiToken: rawToken };
    });

    // Feature 086 US5 — ALWAYS reload Caddy on setup completion so the
    // setup-gate (caddy-config.ts) drops its 302→/setup catch-all and `/`
    // starts serving the platform studio. (Previously this only fired when an
    // apex domain was set; the gate now needs the reload unconditionally.)
    try {
      await reloadCaddy();
    } catch (err) {
      req.log.warn({ err }, 'caddy reload failed during setup completion (Caddy unreachable)');
    }

    return reply.status(201).send(result);
  });
};
