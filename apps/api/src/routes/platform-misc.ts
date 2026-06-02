/**
 * Miscellaneous platform endpoints that Supabase Studio IS_PLATFORM=true
 * expects. Registered under /api/v1 prefix in server.ts.
 *
 * These stubs return the minimal shape Studio needs to render without
 * errors. They are intentionally thin — real data lives in other routes
 * (instances, auth, etc.).
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { decryptJson, loadMasterKey } from '@supastack/crypto';

export const platformMiscRoutes: FastifyPluginAsync = async (app) => {
  // ── Feature flags ──────────────────────────────────────────────────────────
  app.get('/platform/telemetry/feature-flags', async (_req, reply) => {
    return reply.send({ flags: {} });
  });

  // ── Deployment mode ────────────────────────────────────────────────────────
  // Studio uses this to distinguish cloud vs self-hosted behavior.
  app.get('/platform/deployment-mode', async (_req, reply) => {
    return reply.send({ mode: 'self_hosted' });
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
      disabled_features: [
        // feature 025 — reduce the IS_PLATFORM Studio to a self-hosted "supastack cloud".
        // POST-LOGIN features only (runtime, no Studio rebuild). See docs/studio-feature-flags.md.
        // NOTE: pre-login/sign-in-page flags (dashboard_auth:*) are NOT controllable here
        // — there is no profile pre-login — so they live in the Studio source
        // enabled-features.json (build-time) instead.
        'billing:all',
      ],
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
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, user.id))
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
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, user.id))
      .limit(1);
    if (!orgRow) return reply.send([]);
    return reply.send([buildOrg(orgRow.id, orgRow.name, user.role === 'owner')]);
  });

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug', async (req, reply) => {
    const user = app.requireAuth(req);
    const [orgRow] = await db()
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, user.id))
      .limit(1);
    if (!orgRow) return reply.status(404).send({ error: 'Organization not found' });
    return reply.send(buildOrg(orgRow.id, orgRow.name, user.role === 'owner'));
  });

  // ── New-project wizard endpoints ──────────────────────────────────────────
  // Available regions — Wizard crashes at recommendations.smartGroup.name if missing
  app.get('/platform/projects/available-regions', async (req, reply) => {
    app.requireAuth(req);
    const LOCAL_REGION = {
      name: 'local',
      displayName: 'Local (Self-hosted)',
      country: 'Local',
      continent: 'Local',
      available_instance_sizes: ['micro', 'small', 'medium', 'large', 'xlarge'],
    };
    return reply.send({
      recommendations: {
        smartGroup: { name: 'local', region: LOCAL_REGION },
        specific: [],
      },
      all: {
        smartGroup: [LOCAL_REGION],
        specific: [],
      },
    });
  });

  // Postgres versions for new project wizard (oriole / pg engine)
  app.post<{ Params: { slug: string } }>(
    '/platform/organizations/:slug/available-versions',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send([
        {
          postgres_engine: 'postgres',
          release_channel: 'ga',
          displayName: 'PostgreSQL 15',
          postgresVersion: '15.8.1.085',
        },
      ]);
    },
  );

  // Organization preview creation (billing estimate before creating)
  app.post('/platform/organizations/preview-creation', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ has_payment_method: true, project_count: 0, free_project_count: 0 });
  });

  // Postgres versions list for project settings
  app.get('/platform/projects/available-versions', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Create organization ────────────────────────────────────────────────────
  // Supastack is single-org. We can't create additional orgs via Studio, but we
  // return the existing org in the expected shape so Studio navigates correctly.
  app.post('/platform/organizations', async (req, reply) => {
    const user = app.requireAuth(req);
    const [orgRow] = await db()
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, user.id))
      .limit(1);
    if (!orgRow) return reply.status(400).send({ error: 'No organization found for this user' });
    return reply.status(201).send(buildOrg(orgRow.id, orgRow.name, true));
  });

  // ── Create project ─────────────────────────────────────────────────────────
  // Studio POSTs to /platform/projects to create a new project.
  // We delegate to the existing Supastack instance creation endpoint.
  app.post<{ Body: { name: string; organization_slug?: string; db_pass?: string; db_region?: string } }>(
    '/platform/projects',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const body = req.body as Record<string, unknown>;
      const name = (body?.name as string) || 'New Project';
      const dbPass = (body?.db_pass as string) || '';

      // Delegate to the Supastack provisioning endpoint
      // Map Studio's db_pass → Supastack's dbPassword
      const instanceBody: Record<string, unknown> = { name };
      if (dbPass) instanceBody.dbPassword = dbPass;
      const payload = JSON.stringify(instanceBody);
      const resp = await app.inject({
        method: 'POST',
        url: '/api/v1/instances',
        // Use fresh headers — don't pass original Content-Length (payload size differs)
        headers: {
          authorization: req.headers['authorization'] as string,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload).toString(),
        },
        payload,
      });

      if (resp.statusCode >= 400) {
        return reply.status(resp.statusCode).send(resp.json<unknown>());
      }

      const created = resp.json<{ ref: string; name: string; status: string }>();
      const apex = process.env.SUPASTACK_APEX ?? '';
      return reply.status(201).send({
        ref: created.ref,
        name: created.name,
        status: 'COMING_UP',
        cloud_provider: 'SUPASTACK',
        region: 'local',
        organization_id: user.id,
        insertedAt: new Date().toISOString(),
        restUrl: apex ? `https://${created.ref}.${apex}/rest/v1` : '',
        databases: [{ identifier: created.ref, status: 'COMING_UP', region: 'local', cloud_provider: 'SUPASTACK', inserted_at: new Date().toISOString(), infra_compute_size: 'nano' }],
      });
    },
  );

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
        .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
        .where(eq(schema.organizationMembers.userId, user.id))
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
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
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
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
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

  // pgBouncer config PATCH (GET is in the stub loop below)
  app.patch<RefParams>('/platform/projects/:ref/config/pgbouncer', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // Realtime config
  app.get<RefParams>('/platform/projects/:ref/config/realtime', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ max_concurrent_users: 200 });
  });

  app.patch<RefParams>('/platform/projects/:ref/config/realtime', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // Secrets config — proxy to management API secrets routes
  app.get<RefParams>('/platform/projects/:ref/config/secrets', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/secrets`,
      headers: req.headers as Record<string, string>,
    });
    if (resp.statusCode === 200) return reply.status(200).send(resp.json<unknown>());
    return reply.send([]);
  });

  app.patch<RefParams>('/platform/projects/:ref/config/secrets', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/v1/projects/${req.params.ref}/secrets`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    if (resp.statusCode === 200 || resp.statusCode === 201) return reply.status(200).send(resp.json<unknown>());
    return reply.send(req.body ?? {});
  });

  // Auto API config — Studio project home page
  app.get<RefParams>('/platform/projects/:ref/api', async (req, reply) => {
    const user = app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref, portKong: schema.supabaseInstances.portKong, encryptedSecrets: schema.supabaseInstances.encryptedSecrets })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const kongUrl = apex ? `https://${inst.ref}.${apex}` : `http://localhost:${inst.portKong}`;
    const secrets = inst.encryptedSecrets
      ? (decryptJson(inst.encryptedSecrets, loadMasterKey()) as { anonKey?: string; serviceRoleKey?: string })
      : {};
    return reply.send({
      autoApiService: {
        endpoint: kongUrl,
        defaultApiKey: secrets.anonKey ?? '',
        serviceApiKey: secrets.serviceRoleKey ?? '',
      },
    });
  });

  app.get<RefParams>('/platform/projects/:ref/api/rest', async (req, reply) => {
    const user = app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref, portKong: schema.supabaseInstances.portKong })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const kongUrl = apex ? `https://${inst.ref}.${apex}` : `http://localhost:${inst.portKong}`;
    return reply.send({
      endpoint: `${kongUrl}/rest/v1`,
      schema: 'public',
      extraSearchPath: ['public', 'extensions'],
      maxRows: 1000,
    });
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

  // Studio does `data.connections` on this response — must return {connections:[]}
  app.get('/platform/integrations/github/connections', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ connections: [] });
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

  // Get a specific folder by id
  app.get<{ Params: { ref: string; id: string } }>(
    '/platform/projects/:ref/content/folders/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ id: req.params.id });
    },
  );

  // Save a SQL snippet
  app.post<RefParams>('/platform/projects/:ref/content', async (req, reply) => {
    app.requireAuth(req);
    const body = req.body as Record<string, unknown> | undefined;
    return reply.send({ ...(body ?? {}), id: Date.now() });
  });

  // Get a specific content item by id (no persistent store)
  app.get<{ Params: { ref: string; id: string } }>(
    '/platform/projects/:ref/content/item/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(404).send({ error: 'not found' });
    },
  );

  // Service versions — static stub (no per-service version surface in self-hosted)
  app.get<RefParams>('/platform/projects/:ref/service-versions', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  // Temporary API keys — return the project anon + service_role keys
  app.get<RefParams>('/platform/projects/:ref/api-keys/temporary', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ encryptedSecrets: schema.supabaseInstances.encryptedSecrets })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(
        and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)),
      )
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const secrets = inst.encryptedSecrets
      ? (decryptJson(inst.encryptedSecrets, loadMasterKey()) as {
          anonKey?: string;
          serviceRoleKey?: string;
        })
      : {};
    return reply.send({
      anon_key: secrets.anonKey ?? '',
      service_role_key: secrets.serviceRoleKey ?? '',
    });
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

  // ── Analytics log-drains ───────────────────────────────────────────────────
  // Log-drain CRUD stubs — supastack does not yet have a log forwarding service.
  // Studio's Logs > Log Drains page lists/creates/deletes drain configs.
  type LogDrainParams = { Params: { ref: string; token: string } };

  // Analytics usage endpoints — Studio calls these for project home metrics
  app.get<RefParams & { Querystring: Record<string, string> }>(
    '/platform/projects/:ref/analytics/endpoints/:name',
    async (req, reply) => {
      app.requireAuth(req);
      // Return empty result for all analytics usage endpoints
      return reply.send({ result: [] });
    },
  );

  app.get<RefParams>('/platform/projects/:ref/analytics/log-drains', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<RefParams>('/platform/projects/:ref/analytics/log-drains', async (req, reply) => {
    app.requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    return reply.status(201).send({ token: 'stub', ...body });
  });

  app.put<LogDrainParams>(
    '/platform/projects/:ref/analytics/log-drains/:token',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send((req.body ?? {}) as Record<string, unknown>);
    },
  );

  app.delete<LogDrainParams>(
    '/platform/projects/:ref/analytics/log-drains/:token',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

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
        .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
        .where(eq(schema.organizationMembers.userId, user.id))
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
      // Studio expects an array of MemberWithFreeProjectLimit, not an object
      return path.includes('free-project-limit')
        ? reply.send([])
        : reply.send([]);
    });
  }

  app.get<SlugParams>('/platform/organizations/:slug/members/mfa/enforcement', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ required: false });
  });

  app.patch<SlugParams>('/platform/organizations/:slug/members/mfa/enforcement', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? { required: false });
  });

  // GET invite by token — Studio shows invitation details before accepting
  app.get<{ Params: { slug: string; token: string } }>(
    '/platform/organizations/:slug/members/invitations/:token',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ token: req.params.token });
    },
  );

  // POST accept invitation by token
  app.post<{ Params: { slug: string; token: string } }>(
    '/platform/organizations/:slug/members/invitations/:token',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  // POST send invitation
  app.post<SlugParams>('/platform/organizations/:slug/members/invitations', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ id: 1 });
  });

  // DELETE cancel invitation by id
  app.delete<{ Params: { slug: string; id: string } }>(
    '/platform/organizations/:slug/members/invitations/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  // PATCH update member (role change etc.)
  app.patch<{ Params: { slug: string; gotrue_id: string } }>(
    '/platform/organizations/:slug/members/:gotrue_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send(req.body ?? {});
    },
  );

  // DELETE remove member from org
  app.delete<{ Params: { slug: string; gotrue_id: string } }>(
    '/platform/organizations/:slug/members/:gotrue_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  // POST assign role to member
  app.post<{ Params: { slug: string; gotrue_id: string; role_id: string } }>(
    '/platform/organizations/:slug/members/:gotrue_id/roles/:role_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(200).send({});
    },
  );

  // DELETE remove role from member
  app.delete<{ Params: { slug: string; gotrue_id: string; role_id: string } }>(
    '/platform/organizations/:slug/members/:gotrue_id/roles/:role_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  // ── Org Apps (platform marketplace apps / installations) ───────────────────
  type SlugAppParams = { Params: { slug: string; app_id: string } };
  type SlugAppKeyParams = { Params: { slug: string; app_id: string; id: string } };
  type SlugInstallParams = { Params: { slug: string; id: string } };

  app.post<{ Params: { slug: string } }>(
    '/platform/organizations/:slug/apps/installations',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  app.delete<SlugInstallParams>(
    '/platform/organizations/:slug/apps/installations/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  app.get<SlugAppParams>(
    '/platform/organizations/:slug/apps/:app_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  app.patch<SlugAppParams>(
    '/platform/organizations/:slug/apps/:app_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send(req.body ?? {});
    },
  );

  app.delete<SlugAppParams>(
    '/platform/organizations/:slug/apps/:app_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  app.post<SlugAppParams>(
    '/platform/organizations/:slug/apps/:app_id/signing-keys',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(201).send({ id: 'mock-signing-key' });
    },
  );

  app.delete<SlugAppKeyParams>(
    '/platform/organizations/:slug/apps/:app_id/signing-keys/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  // ── Org OAuth Apps ─────────────────────────────────────────────────────────
  type SlugOAuthAppParams = { Params: { slug: string; id: string } };
  type SlugOAuthSecretParams = { Params: { slug: string; id: string; sid: string } };

  app.post<{ Params: { slug: string } }>(
    '/platform/organizations/:slug/oauth/apps',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(201).send({ id: 'mock-oauth-app' });
    },
  );

  app.get<SlugOAuthAppParams>(
    '/platform/organizations/:slug/oauth/apps/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  app.delete<SlugOAuthAppParams>(
    '/platform/organizations/:slug/oauth/apps/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  app.post<SlugOAuthAppParams>(
    '/platform/organizations/:slug/oauth/apps/:id/revoke',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(200).send({});
    },
  );

  app.post<SlugOAuthAppParams>(
    '/platform/organizations/:slug/oauth/apps/:id/client-secrets',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(201).send({ secret: 'mock-client-secret' });
    },
  );

  app.delete<SlugOAuthSecretParams>(
    '/platform/organizations/:slug/oauth/apps/:id/client-secrets/:sid',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  app.get<SlugOAuthAppParams>(
    '/platform/organizations/:slug/oauth/authorizations/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  // ── Global OAuth authorization lookup ─────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/platform/oauth/authorizations/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  // ── Project Infrastructure ─────────────────────────────────────────────────
  // Disk info / config (no real disk management — static stubs)
  app.get<RefParams>('/platform/projects/:ref/disk', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ size_gb: 8, type: 'gp3', iops: 3000, throughput_mbps: 125 });
  });

  app.post<RefParams>('/platform/projects/:ref/disk', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ size_gb: 8 });
  });

  app.get<RefParams>('/platform/projects/:ref/disk/custom-config', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  app.post<RefParams>('/platform/projects/:ref/disk/custom-config', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.get<RefParams>('/platform/projects/:ref/disk/util', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ usage_bytes: 0, total_bytes: 8589934592 });
  });

  // Read replicas (not supported in self-hosted)
  app.get<RefParams>('/platform/projects/:ref/read-replicas', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // Live queries
  app.get<RefParams>('/platform/projects/:ref/live-queries', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // Compute resources
  app.get<{ Params: { ref: string; id: string } }>(
    '/platform/projects/:ref/resources/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ id: req.params.id });
    },
  );

  app.patch<{ Params: { ref: string; id: string } }>(
    '/platform/projects/:ref/resources/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send(req.body ?? {});
    },
  );

  // PrivateLink associations (not supported in self-hosted)
  app.get<RefParams>('/platform/projects/:ref/privatelink/associations', async (req, reply) => {
    app.requireAuth(req);
    // Studio does `data.private_link_associations` on this response
    return reply.send({ private_link_associations: [] });
  });

  app.post<RefParams>(
    '/platform/projects/:ref/privatelink/associations/aws-account',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  app.get<{ Params: { ref: string; id: string } }>(
    '/platform/projects/:ref/privatelink/associations/aws-account/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  // Settings sensitivity (no-op for self-hosted)
  app.patch<RefParams>('/platform/projects/:ref/settings/sensitivity', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // ── Storage — stubs for Supabase-specific storage features not in Kong ────
  // Real bucket CRUD is proxied to Kong's storage API in platform-proxy.ts
  // via the wildcard /platform/storage/:ref/* route.
  // These endpoints (vector-buckets, analytics-buckets, archive) don't exist
  // in Kong's storage API, so we stub them here. Fastify prioritises specific
  // routes over wildcards, so these match before the proxy wildcard fires.
  type StorageRefIdParams = { Params: { ref: string; id: string } };
  type StorageRefIdNameParams = { Params: { ref: string; id: string; name: string } };

  app.get<RefParams>('/platform/storage/:ref/vector-buckets', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<RefParams>('/platform/storage/:ref/vector-buckets', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ id: 'stub' });
  });

  app.delete<StorageRefIdParams>('/platform/storage/:ref/vector-buckets/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.post<StorageRefIdParams>(
    '/platform/storage/:ref/vector-buckets/:id/indexes',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(201).send({});
    },
  );

  app.delete<StorageRefIdNameParams>(
    '/platform/storage/:ref/vector-buckets/:id/indexes/:name',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  app.get<RefParams>('/platform/storage/:ref/analytics-buckets', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<RefParams>('/platform/storage/:ref/analytics-buckets', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ id: 'stub' });
  });

  app.delete<StorageRefIdParams>(
    '/platform/storage/:ref/analytics-buckets/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  app.get<StorageRefIdParams>(
    '/platform/storage/:ref/analytics-buckets/:id/namespaces',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send([]);
    },
  );

  app.post<StorageRefIdParams>(
    '/platform/storage/:ref/analytics-buckets/:id/namespaces',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(201).send({});
    },
  );

  app.get<RefParams>('/platform/storage/:ref/archive', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  // ── Feedback — fire-and-forget, self-hosted has no feedback service ────────
  app.post('/platform/feedback/send', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send();
  });

  app.post('/platform/feedback/upgrade', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send();
  });

  app.post('/platform/feedback/downgrade', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send();
  });

  app.patch<{ Params: { id: string } }>(
    '/platform/feedback/conversations/:id/custom-fields',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  // ── Project Lifecycle ──────────────────────────────────────────────────────
  // Pause: proxy to /v1/projects/:ref/pause (pause-restore management route)
  app.post<RefParams>('/platform/projects/:ref/pause', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/v1/projects/${req.params.ref}/pause`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // Restore (un-pause): proxy to /v1/projects/:ref/restore
  app.post<RefParams>('/platform/projects/:ref/restore', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/v1/projects/${req.params.ref}/restore`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // Restart: proxy to /api/v1/instances/:ref/restart (dashboard instances route)
  app.post<RefParams>('/platform/projects/:ref/restart', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/api/v1/instances/${req.params.ref}/restart`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // Restart-services: same as restart for self-hosted (no per-service granularity)
  app.post<RefParams>('/platform/projects/:ref/restart-services', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/api/v1/instances/${req.params.ref}/restart`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // Resize compute — no-op for self-hosted (all instances are same size)
  app.post<RefParams>('/platform/projects/:ref/resize', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send({});
  });

  // Reset DB password — no-op stub for self-hosted
  app.patch<RefParams>('/platform/projects/:ref/db-password', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send({});
  });

  // Transfer project to another org — not applicable for self-hosted
  app.post<RefParams>('/platform/projects/:ref/transfer', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send({});
  });

  // Transfer preview — not applicable for self-hosted
  app.get<RefParams>('/platform/projects/:ref/transfer/preview', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  // ── Replication (self-hosted: all stubbed as empty / no-op) ──────────────
  type ReplicationSourceParams = { Params: { ref: string; source_id: string } };
  type ReplicationSourcePubParams = { Params: { ref: string; source_id: string; name: string } };
  type ReplicationDestParams = { Params: { ref: string; id: string } };
  type ReplicationPipelineParams = { Params: { ref: string; id: string } };
  type ReplicationDestPipelineParams = { Params: { ref: string; did: string; pid: string } };

  // Sources
  app.get<RefParams>('/platform/replication/:ref/sources', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<ReplicationSourceParams>(
    '/platform/replication/:ref/sources/:source_id/tables',
    async (req, reply) => {
      app.requireAuth(req);
      // Studio does `data.tables` on this response
      return reply.send({ tables: [] });
    },
  );

  app.get<ReplicationSourceParams>(
    '/platform/replication/:ref/sources/:source_id/publications',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send([]);
    },
  );

  app.post<ReplicationSourceParams>(
    '/platform/replication/:ref/sources/:source_id/publications',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  app.delete<ReplicationSourcePubParams>(
    '/platform/replication/:ref/sources/:source_id/publications/:name',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  // Destinations — /validate must be registered before /:id
  app.get<RefParams>('/platform/replication/:ref/destinations', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<RefParams>(
    '/platform/replication/:ref/destinations/validate',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ valid: true });
    },
  );

  app.post<RefParams>('/platform/replication/:ref/destinations', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ id: 'mock' });
  });

  app.patch<ReplicationDestParams>(
    '/platform/replication/:ref/destinations/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send(req.body ?? {});
    },
  );

  app.delete<ReplicationDestParams>(
    '/platform/replication/:ref/destinations/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  // Pipelines — /validate must be registered before /:id
  app.get<RefParams>('/platform/replication/:ref/pipelines', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<RefParams>(
    '/platform/replication/:ref/pipelines/validate',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ valid: true });
    },
  );

  app.post<RefParams>('/platform/replication/:ref/pipelines', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ id: 'mock' });
  });

  app.delete<ReplicationPipelineParams>(
    '/platform/replication/:ref/pipelines/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  app.post<ReplicationPipelineParams>(
    '/platform/replication/:ref/pipelines/:id/start',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(200).send();
    },
  );

  app.post<ReplicationPipelineParams>(
    '/platform/replication/:ref/pipelines/:id/stop',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(200).send();
    },
  );

  app.get<ReplicationPipelineParams>(
    '/platform/replication/:ref/pipelines/:id/status',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ status: 'stopped' });
    },
  );

  app.get<ReplicationPipelineParams>(
    '/platform/replication/:ref/pipelines/:id/version',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ version: '1.0.0' });
    },
  );

  app.get<ReplicationPipelineParams>(
    '/platform/replication/:ref/pipelines/:id/replication-status',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  app.post<ReplicationPipelineParams>(
    '/platform/replication/:ref/pipelines/:id/rollback-tables',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  // Destinations+Pipelines combined
  app.post<RefParams>(
    '/platform/replication/:ref/destinations-pipelines',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  app.delete<ReplicationDestPipelineParams>(
    '/platform/replication/:ref/destinations-pipelines/:did/:pid',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  // Tenants
  app.get<RefParams>('/platform/replication/:ref/tenants', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<RefParams>('/platform/replication/:ref/tenants-sources', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  app.delete<RefParams>('/platform/replication/:ref/tenants', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  // ── Account management stubs — self-hosted uses its own auth flow ────────
  app.post('/platform/signup', async (_req, reply) => {
    return reply.send({});
  });

  app.post('/platform/reset-password', async (_req, reply) => {
    return reply.send({});
  });

  app.post('/platform/update-email', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  // Organization PATCH (rename, etc.) — echo the body back
  app.patch<SlugParams>('/platform/organizations/:slug', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // Organization available Postgres versions
  app.get<SlugParams>('/platform/organizations/:slug/available-versions', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // Org billing mutations — no-op for self-hosted
  app.post<SlugParams>(
    '/platform/organizations/:slug/billing/subscription/confirm',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({});
    },
  );

  app.post<SlugParams>(
    '/platform/organizations/:slug/billing/upgrade-request',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(200).send({});
    },
  );

  app.post<SlugParams>(
    '/platform/organizations/:slug/payments/setup-intent',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ client_secret: null });
    },
  );

  // Marketplace / confirm-subscription stubs
  app.post('/platform/organizations/cloud-marketplace', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  app.post('/platform/organizations/confirm-subscription', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  // Database backup operations not yet wired to the backup service
  app.post<RefParams>('/platform/database/:ref/backups/restore', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ status: 'restoring' });
  });

  app.post<RefParams>('/platform/database/:ref/backups/restore-physical', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ status: 'restoring' });
  });

  app.post<RefParams>(
    '/platform/database/:ref/backups/enable-physical-backups',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(200).send({});
    },
  );

  app.post<RefParams>('/platform/database/:ref/clone', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ status: 'cloning' });
  });

  app.post<RefParams>('/platform/database/:ref/hook-enable', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send({});
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
  // connectionString must be truthy for IS_PLATFORM=true Studio to allow pg-meta calls.
  // The actual value is stripped by the pg-meta proxy (x-connection-encrypted is in
  // STRIP_REQUEST_HEADERS), so this only needs to pass Boolean() and URL.parse() gracefully.
  const connectionString = apex
    ? `postgresql://postgres:supastack@db.${inst.ref}.${apex}:5432/postgres`
    : `postgresql://postgres:supastack@localhost:5432/postgres`;
  return {
    cloud_provider: 'SUPASTACK',
    connectionString,
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
