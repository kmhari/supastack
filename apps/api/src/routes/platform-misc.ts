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

  // ── Top-level project listing ──────────────────────────────────────────────
  // Studio also calls /platform/projects directly (not org-scoped) for some views.
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/platform/projects',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const apex = process.env.SUPASTACK_APEX ?? '';
      const limit = parseInt(req.query.limit ?? '100', 10);
      const offset = parseInt(req.query.offset ?? '0', 10);
      const instances = await db()
        .select({
          ref: schema.supabaseInstances.ref,
          name: schema.supabaseInstances.name,
          status: schema.supabaseInstances.status,
          portKong: schema.supabaseInstances.portKong,
          insertedAt: schema.supabaseInstances.createdAt,
          updatedAt: schema.supabaseInstances.updatedAt,
          orgId: schema.supabaseInstances.orgId,
        })
        .from(schema.supabaseInstances)
        .innerJoin(schema.orgMembers, eq(schema.orgMembers.orgId, schema.supabaseInstances.orgId))
        .where(eq(schema.orgMembers.userId, user.id))
        .limit(limit)
        .offset(offset);
      const projects = instances.map((inst) => buildProject(inst, apex));
      return reply.send({ pagination: { count: projects.length, limit, offset }, projects });
    },
  );

  // ── Project-level platform routes ─────────────────────────────────────────
  type RefParams = { Params: { ref: string } };

  // Single project detail
  app.get<RefParams>('/platform/projects/:ref', async (req, reply) => {
    const user = app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    const [inst] = await db()
      .select({
        ref: schema.supabaseInstances.ref,
        name: schema.supabaseInstances.name,
        status: schema.supabaseInstances.status,
        portKong: schema.supabaseInstances.portKong,
        insertedAt: schema.supabaseInstances.createdAt,
        updatedAt: schema.supabaseInstances.updatedAt,
        orgId: schema.supabaseInstances.orgId,
      })
      .from(schema.supabaseInstances)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.orgId, schema.supabaseInstances.orgId))
      .where(eq(schema.supabaseInstances.ref, req.params.ref) && eq(schema.orgMembers.userId, user.id) as never)
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send(buildProject(inst, apex));
  });

  app.patch<RefParams>('/platform/projects/:ref', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // Databases
  app.get<RefParams>('/platform/projects/:ref/databases', async (req, reply) => {
    const user = app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref, portKong: schema.supabaseInstances.portKong, insertedAt: schema.supabaseInstances.createdAt })
      .from(schema.supabaseInstances)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.orgId, schema.supabaseInstances.orgId))
      .where(eq(schema.supabaseInstances.ref, req.params.ref) && eq(schema.orgMembers.userId, user.id) as never)
      .limit(1);
    if (!inst) return reply.send([]);
    const kongUrl = apex ? `https://${inst.ref}.${apex}` : `http://localhost:${inst.portKong}`;
    return reply.send([{
      cloud_provider: 'SUPASTACK',
      connectionString: '',
      connection_string_read_only: null,
      db_host: apex || 'localhost',
      db_name: 'postgres',
      db_port: 5432,
      identifier: inst.ref,
      inserted_at: inst.insertedAt?.toISOString() ?? new Date().toISOString(),
      region: 'local',
      restUrl: `${kongUrl}`,
      size: 'micro',
      status: 'ACTIVE_HEALTHY',
    }]);
  });

  // Auth config — proxy to the auth-config management route internally
  // Studio calls GET/PATCH /platform/auth/:ref/config
  app.get<RefParams>('/platform/auth/:ref/config', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'GET', url: `/api/v1/projects/${req.params.ref}/config/auth`, headers: req.headers as Record<string, string> });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.patch<RefParams>('/platform/auth/:ref/config', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'PATCH', url: `/api/v1/projects/${req.params.ref}/config/auth`, headers: req.headers as Record<string, string>, payload: JSON.stringify(req.body) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // Billing addons
  app.get<RefParams>('/platform/projects/:ref/billing/addons', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ available_addons: [], selected_addons: [] });
  });

  // Storage config
  app.get<RefParams>('/platform/projects/:ref/config/storage', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ fileSizeLimit: 52428800, features: { imageTransformation: { enabled: true } } });
  });

  // PostgREST config — delegate to existing management route for real data, stub if not found
  app.get<RefParams>('/platform/projects/:ref/config/postgrest', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/config/postgrest`,
      headers: req.headers as Record<string, string>,
    });
    if (resp.statusCode === 200) return reply.status(200).send(resp.json<unknown>());
    return reply.send({ db_schema: 'public', db_extra_search_path: 'public, extensions', max_rows: 1000, db_pool: 15 });
  });

  app.patch<RefParams>('/platform/projects/:ref/config/postgrest', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${req.params.ref}/config/postgrest`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    if (resp.statusCode === 200) return reply.status(200).send(resp.json<unknown>());
    return reply.send(req.body ?? {});
  });

  // Resource warnings
  app.get('/platform/projects-resource-warnings', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // Integrations (GitHub, etc.)
  app.get('/platform/integrations', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<{ Params: { slug: string } }>('/platform/integrations/:slug', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get('/platform/integrations/github/connections', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get('/platform/integrations/github/authorization', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ app: null });
  });

  app.get('/platform/integrations/github/repositories', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ data: [] });
  });

  // Database backups
  app.get<RefParams>('/platform/database/:ref/backups', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ backups: [], tierId: 'free', tierKey: 'FREE' });
  });

  app.get<RefParams>('/platform/database/:ref/backups/downloadable-backups', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ backups: [] });
  });

  app.post<RefParams>('/platform/database/:ref/backups/download', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ url: null });
  });

  // Databases statuses (project home page)
  app.get<RefParams>('/platform/projects/:ref/databases-statuses', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([{ identifier: req.params.ref, status: 'ACTIVE_HEALTHY' }]);
  });

  // Content endpoints — shapes validated against Studio data fetchers
  // /content/folders: getSQLSnippetFolders expects data.data.{folders,contents} + data.cursor
  app.get<RefParams>('/platform/projects/:ref/content/folders', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ data: { folders: [], contents: [] }, cursor: null });
  });
  // /content: getSqlSnippets expects data.data (array) + data.cursor
  app.get<RefParams>('/platform/projects/:ref/content', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ data: [], cursor: null });
  });
  app.get<RefParams>('/platform/projects/:ref/content/count', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ count: 0 });
  });
  // Misc project stubs — key is always path.split('/').pop()
  for (const path of [
    '/platform/projects/:ref/settings',
    '/platform/projects/:ref/members',
    '/platform/projects/:ref/pause/status',
    '/platform/projects/:ref/daily-stats',
    '/platform/projects/:ref/infra-monitoring',
    '/platform/projects/:ref/config/pgbouncer',
    '/platform/projects/:ref/config/pgbouncer/status',
    '/platform/projects/:ref/config/secrets/update-status',
    '/platform/projects/:ref/notifications/advisor/exceptions',
    '/platform/projects/:ref/restore/versions',
    '/platform/projects/:ref/run-lints',
    '/platform/projects/:ref/load-balancers',
  ] as const) {
    app.get(path, async (req, reply) => {
      app.requireAuth(req);
      const stub: Record<string, unknown> = {
        'pause/status': { initiated_at: null, status: 'not_pausing' },
        'daily-stats': { data: [] },
        'infra-monitoring': { data: [] },
        'config/pgbouncer': { pool_mode: 'transaction', default_pool_size: 15, ignore_startup_parameters: 'extra_float_digits' },
        'config/pgbouncer/status': { active: true },
        'config/secrets/update-status': { updating: false },
        'notifications/advisor/exceptions': { result: [] },
        'restore/versions': [],
        'run-lints': [],
        'load-balancers': [],
        'members': { members: [] },
        'settings': {},
      };
      const key = path.split('/').pop()!;
      return reply.send(stub[key] ?? {});
    });
  }

  // ── Org-scoped project listing ─────────────────────────────────────────────
  // Studio calls /platform/organizations/:slug/projects to populate the project list.
  app.get<{ Params: { slug: string }; Querystring: { limit?: string; offset?: string } }>(
    '/platform/organizations/:slug/projects',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const limit = parseInt(req.query.limit ?? '96', 10);
      const offset = parseInt(req.query.offset ?? '0', 10);
      const apex = process.env.SUPASTACK_APEX ?? '';

      const instances = await db()
        .select({
          ref: schema.supabaseInstances.ref,
          name: schema.supabaseInstances.name,
          status: schema.supabaseInstances.status,
          portKong: schema.supabaseInstances.portKong,
          insertedAt: schema.supabaseInstances.createdAt,
          updatedAt: schema.supabaseInstances.updatedAt,
          orgId: schema.supabaseInstances.orgId,
        })
        .from(schema.supabaseInstances)
        .innerJoin(schema.orgMembers, eq(schema.orgMembers.orgId, schema.supabaseInstances.orgId))
        .where(eq(schema.orgMembers.userId, user.id))
        .limit(limit)
        .offset(offset);

      const projects = instances.map((inst) => buildProject(inst, apex));
      return reply.send({ pagination: { count: projects.length, limit, offset }, projects });
    },
  );

  // ── Org-scoped stubs ───────────────────────────────────────────────────────
  type SlugParams = { Params: { slug: string } };

  app.get<SlugParams>('/platform/organizations/:slug/members', async (req, reply) => {
    const user = app.requireAuth(req);
    return reply.send([{ gotrue_id: user.id, username: user.email.split('@')[0], primary_email: user.email, role_ids: [1] }]);
  });

  app.get<SlugParams>('/platform/organizations/:slug/roles', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ org_scoped_roles: [{ id: 1, name: 'Owner', description: null, base_role_id: 1, projects: [] }], project_scoped_roles: [] });
  });

  app.get<SlugParams>('/platform/organizations/:slug/billing/subscription', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ plan: { id: 'free', name: 'Free' }, billing_via_partner: false, usage_billing_enabled: false, project_addons: [], addons: [] });
  });

  app.get<SlugParams>('/platform/organizations/:slug/billing/plans', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([{ id: 'free', name: 'Free' }]);
  });

  app.get<SlugParams>('/platform/organizations/:slug/billing/credits/balance', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ balance: 0 });
  });

  app.head<SlugParams>('/platform/organizations/:slug/billing/invoices', async (req, reply) => {
    app.requireAuth(req);
    reply.header('X-Total-Count', '0');
    return reply.status(200).send();
  });

  app.get<SlugParams>('/platform/organizations/:slug/billing/invoices', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<SlugParams>('/platform/organizations/:slug/entitlements', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ entitlements: [] });
  });

  app.get<SlugParams>('/platform/organizations/:slug/usage', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ usage_billing_enabled: false, usages: [] });
  });

  app.get<SlugParams>('/platform/organizations/:slug/usage/daily', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ usages: [] });
  });

  app.get<SlugParams>('/platform/organizations/:slug/audit', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ result: [], count: 0 });
  });

  // invitations: Studio destructures as `orgInvites.invitations.map(...)` — must be { invitations: [] }
  app.get<SlugParams>('/platform/organizations/:slug/members/invitations', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ invitations: [] });
  });

  for (const path of [
    '/platform/organizations/:slug/sso',
    '/platform/organizations/:slug/apps',
    '/platform/organizations/:slug/apps/installations',
    '/platform/organizations/:slug/oauth/apps',
    '/platform/organizations/:slug/members/reached-free-project-limit',
  ] as const) {
    app.get(path, async (req, reply) => {
      app.requireAuth(req);
      return path.includes('free-project-limit')
        ? reply.send({ reached_free_project_limit: false })
        : reply.send([]);
    });
  }

  app.get<SlugParams>('/platform/organizations/:slug/members/mfa/enforcement', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ required: false });
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

function buildProject(
  inst: { ref: string; name: string; status: string; portKong: number; insertedAt: Date | null; updatedAt: Date | null; orgId: string },
  apex: string,
) {
  const kongUrl = apex ? `https://${inst.ref}.${apex}` : `http://localhost:${inst.portKong}`;
  return {
    cloud_provider: 'SUPASTACK',
    connectionString: '',
    db_host: apex || 'localhost',
    dbVersion: '150009',
    high_availability: false,
    id: inst.ref,
    infra_compute_size: 'nano',
    inserted_at: inst.insertedAt?.toISOString() ?? new Date().toISOString(),
    integration_source: null,
    is_branch_enabled: false,
    is_physical_backups_enabled: false,
    name: inst.name,
    organization_id: inst.orgId,
    parent_project_ref: null,
    ref: inst.ref,
    region: 'local',
    restUrl: `${kongUrl}/rest/v1`,
    status: inst.status === 'running' ? 'ACTIVE_HEALTHY' : inst.status.toUpperCase(),
    subscription_id: null,
    updated_at: inst.updatedAt?.toISOString() ?? new Date().toISOString(),
    volumeSizeGb: 8,
    databases: [
      {
        cloud_provider: 'SUPASTACK',
        identifier: inst.ref,
        infra_compute_size: 'nano',
        inserted_at: inst.insertedAt?.toISOString() ?? new Date().toISOString(),
        region: 'local',
        status: inst.status === 'running' ? 'ACTIVE_HEALTHY' : inst.status.toUpperCase(),
      },
    ],
  };
}

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
