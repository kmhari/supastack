/**
 * Miscellaneous platform endpoints that Supabase Studio IS_PLATFORM=true
 * expects. Registered under /api/v1 prefix in server.ts.
 *
 * These stubs return the minimal shape Studio needs to render without
 * errors. They are intentionally thin — real data lives in other routes
 * (instances, auth, etc.).
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';

export const platformMiscRoutes: FastifyPluginAsync = async (app) => {
  // ── Feature flags ──────────────────────────────────────────────────────────
  app.get('/platform/telemetry/feature-flags', async (_req, reply) => {
    return reply.send({ flags: {} });
  });

  // ── Profile ────────────────────────────────────────────────────────────────
  // Studio calls this immediately after login to get the current user's profile.
  app.get('/platform/profile', async (req, reply) => {
    const user = app.requireAuth(req);
    return reply.send({
      auth0_id: `supastack|${user.id}`,
      gotrue_id: user.id,
      id: 1,
      primary_email: user.email,
      username: user.email.split('@')[0],
      first_name: '',
      last_name: '',
      mobile: null,
      is_alpha_user: false,
      is_sso_user: false,
      disabled_features: [],
      free_project_limit: 999,
    });
  });

  app.put('/platform/profile', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.patch('/platform/profile', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // Log audit events (Studio calls this on login — no-op is fine)
  app.post('/platform/profile/audit-login', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send({});
  });

  // ── Permissions ────────────────────────────────────────────────────────────
  // Studio uses this to gate UI — wildcard grant gives full access.
  app.get('/platform/profile/permissions', async (req, reply) => {
    const user = app.requireAuth(req);
    // Look up org id for this user (Supastack orgs have no slug — use id)
    const [orgRow] = await db()
      .select({ id: schema.org.id, name: schema.org.name })
      .from(schema.org)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.orgId, schema.org.id))
      .where(eq(schema.orgMembers.userId, user.id))
      .limit(1);

    return reply.send([
      {
        actions: ['%'],
        resources: ['%'],
        organization_slug: orgRow?.id ?? 'local-org',
        project_refs: [],
        restrictive: false,
        condition: null,
      },
    ]);
  });

  // Access tokens (PATs) — delegate to auth routes for real data
  app.get('/platform/profile/access-tokens', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post('/platform/profile/access-tokens', async (req, reply) => {
    app.requireAuth(req);
    const body = req.body as Record<string, unknown> | undefined;
    return reply.status(201).send({
      id: 1,
      name: body?.name ?? 'token',
      token: 'sbp_placeholder',
      created_at: new Date().toISOString(),
    });
  });

  app.delete<{ Params: { id: string } }>(
    '/platform/profile/access-tokens/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  app.get('/platform/profile/scoped-access-tokens', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get('/platform/profile/audit', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ result: [], count: 0 });
  });

  // ── Notifications ──────────────────────────────────────────────────────────
  app.get('/platform/notifications', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get('/platform/notifications/summary', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ unread: 0 });
  });

  app.patch('/platform/notifications', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.patch('/platform/notifications/archive-all', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  // ── Organizations ──────────────────────────────────────────────────────────
  // Studio calls /platform/organizations to show the org switcher.
  // Supastack is single-org — return the singleton org in Studio's shape.
  app.get('/platform/organizations', async (req, reply) => {
    const user = app.requireAuth(req);
    const [orgRow] = await db()
      .select({ id: schema.org.id, name: schema.org.name })
      .from(schema.org)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.orgId, schema.org.id))
      .where(eq(schema.orgMembers.userId, user.id))
      .limit(1);
    if (!orgRow) return reply.send([]);
    return reply.send([buildOrg(orgRow.id, orgRow.name, user.role === 'admin')]);
  });

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug', async (req, reply) => {
    const user = app.requireAuth(req);
    const [orgRow] = await db()
      .select({ id: schema.org.id, name: schema.org.name })
      .from(schema.org)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.orgId, schema.org.id))
      .where(eq(schema.orgMembers.userId, user.id))
      .limit(1);
    if (!orgRow) return reply.status(404).send({ error: 'Organization not found' });
    return reply.send(buildOrg(orgRow.id, orgRow.name, user.role === 'admin'));
  });

  // ── Stripe / billing stubs — self-hosted has no billing ───────────────────
  app.get('/platform/stripe/invoices/overdue', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post('/platform/stripe/setup-intent', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ client_secret: null });
  });
};

function buildOrg(id: string, name: string, isOwner: boolean) {
  return {
    id,
    name,
    slug: id,
    billing_email: '',
    billing_partner: null,
    integration_source: null,
    is_owner: isOwner,
    opt_in_tags: [],
    organization_missing_address: false,
    organization_missing_tax_id: false,
    organization_requires_mfa: false,
    plan: { id: 'free', name: 'Free' },
    restriction_data: null,
    restriction_status: null,
    stripe_customer_id: null,
    subscription_id: null,
    usage_billing_enabled: false,
  };
}
