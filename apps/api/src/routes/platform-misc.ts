/**
 * Miscellaneous platform endpoints that Supabase Studio IS_PLATFORM=true
 * expects. Registered under /api/v1 prefix in server.ts.
 *
 * These stubs return the minimal shape Studio needs to render without
 * errors. They are intentionally thin — real data lives in other routes
 * (instances, auth, etc.).
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { decryptJson, encryptJson, loadMasterKey, signSupabaseJwt } from '@supastack/crypto';
import { ROLE_IDS, ROLE_NAMES, roleFromId, type Role } from '@supastack/shared';
import { mintApiToken } from '../services/api-tokens.js';
import { createOrganizationWithOwner } from '../services/org-store.js';
import {
  listBackupsForPlatform,
  resolveBackupSeq,
  initiateRestore,
  enqueueRestore,
  hashRefToInt,
  RestoreError,
} from '../services/backups-mgmt-service.js';
import {
  hashInviteToken,
  memberRole,
  newInviteToken,
  ownerCount,
} from '../services/org-membership.js';
import { sendRecoveryEmail, signupGotrueUser, updateGotrueUser } from '../services/gotrue-admin.js';
import { toApiKeys, toStudioKeys } from '../services/auth-config-case.js';
import {
  resetPgPasswordForInstance,
  InstanceNotFoundForResetError,
  InstanceNotResettableError,
  PerInstanceDbUnreachableError,
} from '../services/pg-password-reset.js';
import { withPerInstancePg, InstanceNotRunningError } from '../services/per-instance-pg.js';

// ── Lint check definitions (Tier 4, T017) ─────────────────────────────────────
const LINT_CHECKS: Record<string, {
  title: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  categories: string[];
  description: string;
  sql: string;
  mapRow: (row: Record<string, unknown>) => Record<string, unknown>;
}> = {
  no_rls: {
    title: 'Tables Without Row Level Security',
    level: 'WARN',
    categories: ['SECURITY'],
    description: 'Tables in the public schema without RLS enabled',
    sql: `SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false AND tablename NOT LIKE 'pg_%'`,
    mapRow: (r) => ({ schema: r.schemaname, table: r.tablename }),
  },
  duplicate_index: {
    title: 'Duplicate Indexes',
    level: 'WARN',
    categories: ['PERFORMANCE'],
    description: 'Indexes covering identical columns on the same table',
    sql: `SELECT tablename, indexdef, count(*) AS cnt FROM pg_indexes WHERE schemaname = 'public' GROUP BY tablename, indexdef HAVING count(*) > 1`,
    mapRow: (r) => ({ table: r.tablename, indexdef: r.indexdef, count: r.cnt }),
  },
  unused_index: {
    title: 'Unused Indexes',
    level: 'INFO',
    categories: ['PERFORMANCE'],
    description: 'Non-primary indexes that have never been scanned on non-empty tables',
    sql: `SELECT s.indexrelname AS indexname, s.relname AS tablename FROM pg_stat_user_indexes s JOIN pg_stat_user_tables t ON s.relname = t.relname WHERE s.idx_scan = 0 AND t.n_live_tup > 0 AND s.indexrelname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p','u'))`,
    mapRow: (r) => ({ index: r.indexname, table: r.tablename }),
  },
  bloat: {
    title: 'Table Bloat',
    level: 'INFO',
    categories: ['PERFORMANCE'],
    description: 'Tables with significant dead tuple accumulation (>10% dead tuples)',
    sql: `SELECT relname AS tablename, n_dead_tup, n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 0 AND n_dead_tup > n_live_tup * 0.1`,
    mapRow: (r) => ({ table: r.tablename, dead_tuples: r.n_dead_tup, live_tuples: r.n_live_tup }),
  },
  sequence_wraparound: {
    title: 'Sequences Near Exhaustion',
    level: 'WARN',
    categories: ['PERFORMANCE'],
    description: 'Sequences that have consumed more than 80% of their range',
    sql: `SELECT sequencename, last_value, max_value FROM pg_sequences WHERE max_value > 0 AND last_value IS NOT NULL AND last_value::float / max_value > 0.8`,
    mapRow: (r) => ({ sequence: r.sequencename, last_value: r.last_value, max_value: r.max_value }),
  },
};

export const platformMiscRoutes: FastifyPluginAsync = async (app) => {
  // ── Feature flags ──────────────────────────────────────────────────────────
  app.get('/platform/telemetry/feature-flags', async (_req, reply) => {
    return reply.send({ flags: {} });
  });

  app.post('/platform/telemetry/event', async (_req, reply) => {
    return reply.status(204).send();
  });

  app.post('/platform/telemetry/feature-flags/track', async (_req, reply) => {
    return reply.status(204).send();
  });

  app.post('/platform/telemetry/groups/identify', async (_req, reply) => {
    return reply.status(204).send();
  });

  app.post('/platform/telemetry/groups/reset', async (_req, reply) => {
    return reply.status(204).send();
  });

  app.post('/platform/telemetry/identify', async (_req, reply) => {
    return reply.status(204).send();
  });

  app.post('/platform/telemetry/reset', async (_req, reply) => {
    return reply.status(204).send();
  });

  app.get('/platform/telemetry/stream', async (_req, reply) => {
    return reply.status(200).send([]);
  });

  // ── Deployment mode ────────────────────────────────────────────────────────
  // Studio uses this to distinguish cloud vs self-hosted behavior.
  app.get('/platform/deployment-mode', async (_req, reply) => {
    return reply.send({ mode: 'self_hosted' });
  });

  // ── Profile ────────────────────────────────────────────────────────────────
  // Studio calls this immediately after login to get the current user's profile.
  // Delegates to GET /v1/profile to get DB-validated id + primary_email,
  // then augments with Studio-required fields (FR-001, FR-002).
  app.get('/platform/profile', async (req, reply) => {
    app.requireAuth(req);
    const v1Resp = await app.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: fwdHeaders(req),
    });
    if (v1Resp.statusCode !== 200) {
      return reply.status(v1Resp.statusCode).send(v1Resp.json<unknown>());
    }
    const { id, primary_email } = v1Resp.json<{ id: string; primary_email: string }>();
    return reply.send({
      id,
      primary_email,
      gotrue_id: id,
      username: primary_email.split('@')[0],
      free_project_limit: 999,
      is_alpha_user: false,
      is_sso_user: false,
      disabled_features: [
        // Feature 084 — hide billing + cross-org transfer in self-hosted.
        'billing:account_data',
        'billing:credits',
        'billing:invoices',
        'billing:payment_methods',
        'projects:transfer',
      ],
      auth0_id: `supastack|${id}`,
      first_name: '',
      last_name: '',
      mobile: null,
    });
  });

  app.post('/platform/profile', async (req, reply) => {
    app.requireAuth(req);
    const v1Resp = await app.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: fwdHeaders(req),
    });
    if (v1Resp.statusCode !== 200) {
      return reply.status(v1Resp.statusCode).send(v1Resp.json<unknown>());
    }
    const { id, primary_email } = v1Resp.json<{ id: string; primary_email: string }>();
    return reply.send({
      id,
      primary_email,
      gotrue_id: id,
      username: primary_email.split('@')[0],
      free_project_limit: 999,
      is_alpha_user: false,
      is_sso_user: false,
      disabled_features: [
        'billing:account_data',
        'billing:credits',
        'billing:invoices',
        'billing:payment_methods',
        'projects:transfer',
      ],
      auth0_id: `supastack|${id}`,
      first_name: '',
      last_name: '',
      mobile: null,
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
  // Feature 084 — one permission entry per org the caller belongs to. These drive
  // client-side UI gating only; the server-side authorize()/authorizeOrg() RBAC is
  // authoritative. Wildcard actions keep the UI fully enabled; read_only is still
  // blocked at the API by the matrix.
  app.get('/platform/profile/permissions', async (req, reply) => {
    const user = app.requireAuth(req);
    const memberships = await db()
      .select({ orgId: schema.organizationMembers.organizationId })
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, user.id));

    return reply.send(
      memberships.map((m) => ({
        actions: ['%'],
        resources: ['%'],
        organization_id: m.orgId,
        organization_slug: m.orgId,
        project_ids: null,
        project_refs: null,
        restrictive: false,
        condition: null,
      })),
    );
  });

  // Access tokens (PATs) — feature 084 US2. Backed by the real `api_tokens`
  // store (same tokens the CLI/MCP use); mapped to Studio's AccessToken shape.
  app.get('/platform/profile/access-tokens', async (req, reply) => {
    const user = app.requireAuth(req);
    const rows = await db()
      .select({
        id: schema.apiTokens.id,
        name: schema.apiTokens.label,
        tokenAlias: schema.apiTokens.prefix,
        createdAt: schema.apiTokens.createdAt,
        lastUsedAt: schema.apiTokens.lastUsedAt,
      })
      .from(schema.apiTokens)
      .where(and(eq(schema.apiTokens.userId, user.id), isNull(schema.apiTokens.revokedAt)))
      .orderBy(desc(schema.apiTokens.createdAt));
    return reply.send(rows.map((r) => toAccessToken(r)));
  });

  app.post('/platform/profile/access-tokens', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as { name?: string };
    const name = body.name?.trim() || 'Access token';
    const { raw, id, prefix } = await mintApiToken(db(), user.id, name, 'studio');
    return reply.status(201).send({
      ...toAccessToken({ id, name, tokenAlias: prefix, createdAt: new Date(), lastUsedAt: null }),
      token: raw, // shown once
    });
  });

  app.delete<{ Params: { id: string } }>(
    '/platform/profile/access-tokens/:id',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const [row] = await db()
        .select({
          id: schema.apiTokens.id,
          name: schema.apiTokens.name,
          tokenAlias: schema.apiTokens.tokenAlias,
          createdAt: schema.apiTokens.createdAt,
          lastUsedAt: schema.apiTokens.lastUsedAt,
          userId: schema.apiTokens.userId,
        })
        .from(schema.apiTokens)
        .where(eq(schema.apiTokens.id, req.params.id))
        .limit(1);
      if (!row || row.userId !== user.id) return reply.status(404).send({ error: 'Not found' });
      await db()
        .update(schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.apiTokens.id, req.params.id));
      return reply.status(200).send(toAccessToken(row));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/platform/profile/access-tokens/:id',
    async (req, reply) => {
      const user = app.requireAuth(req);
      try {
        const [row] = await db()
          .select({
            id: schema.apiTokens.id,
            name: schema.apiTokens.label,
            tokenAlias: schema.apiTokens.prefix,
            createdAt: schema.apiTokens.createdAt,
            lastUsedAt: schema.apiTokens.lastUsedAt,
          })
          .from(schema.apiTokens)
          .where(
            and(
              eq(schema.apiTokens.id, req.params.id),
              eq(schema.apiTokens.userId, user.id),
              isNull(schema.apiTokens.revokedAt),
            ),
          )
          .limit(1);
        if (!row) return reply.status(404).send({ error: 'not_found' });
        return reply.send(toAccessToken(row));
      } catch {
        return reply.status(404).send({ error: 'not_found' });
      }
    },
  );

  app.get('/platform/profile/scoped-access-tokens', async (req, reply) => {
    const user = app.requireAuth(req);
    const rows = await db()
      .select({
        id: schema.apiTokens.id,
        name: schema.apiTokens.label,
        tokenAlias: schema.apiTokens.prefix,
        createdAt: schema.apiTokens.createdAt,
        lastUsedAt: schema.apiTokens.lastUsedAt,
      })
      .from(schema.apiTokens)
      .where(and(eq(schema.apiTokens.userId, user.id), isNull(schema.apiTokens.revokedAt)))
      .orderBy(desc(schema.apiTokens.createdAt));
    return reply.send({ tokens: rows.map((r) => toAccessToken(r)) });
  });

  app.post('/platform/profile/scoped-access-tokens', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as {
      name?: string;
      permissions?: string[];
      organization_slugs?: string[];
      project_refs?: string[];
    };
    const name = body.name?.trim() || 'Scoped token';
    const { raw, id, prefix } = await mintApiToken(db(), user.id, name, 'studio');
    return reply.status(201).send({
      ...toAccessToken({ id, name, tokenAlias: prefix, createdAt: new Date(), lastUsedAt: null }),
      token: raw,
      permissions: body.permissions ?? [],
      organization_slugs: body.organization_slugs ?? [],
      project_refs: body.project_refs ?? [],
    });
  });

  app.get<{ Params: { id: string } }>(
    '/platform/profile/scoped-access-tokens/:id',
    async (req, reply) => {
      const user = app.requireAuth(req);
      try {
        const [row] = await db()
          .select({
            id: schema.apiTokens.id,
            name: schema.apiTokens.label,
            tokenAlias: schema.apiTokens.prefix,
            createdAt: schema.apiTokens.createdAt,
            lastUsedAt: schema.apiTokens.lastUsedAt,
          })
          .from(schema.apiTokens)
          .where(
            and(
              eq(schema.apiTokens.id, req.params.id),
              eq(schema.apiTokens.userId, user.id),
              isNull(schema.apiTokens.revokedAt),
            ),
          )
          .limit(1);
        if (!row) return reply.status(404).send({ error: 'not_found' });
        return reply.send({
          ...toAccessToken(row),
          permissions: [],
          organization_slugs: [],
          project_refs: [],
        });
      } catch {
        return reply.status(404).send({ error: 'not_found' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/platform/profile/scoped-access-tokens/:id',
    async (req, reply) => {
      const user = app.requireAuth(req);
      try {
        const [row] = await db()
          .select({ userId: schema.apiTokens.userId })
          .from(schema.apiTokens)
          .where(
            and(eq(schema.apiTokens.id, req.params.id), isNull(schema.apiTokens.revokedAt)),
          )
          .limit(1);
        if (!row || row.userId !== user.id) return reply.status(404).send({ error: 'not_found' });
        await db()
          .update(schema.apiTokens)
          .set({ revokedAt: new Date() })
          .where(eq(schema.apiTokens.id, req.params.id));
        return reply.status(200).send();
      } catch {
        return reply.status(404).send({ error: 'not_found' });
      }
    },
  );

  app.get<{ Querystring: { page?: string; rows?: string } }>(
    '/platform/profile/audit',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const limit = Math.min(parseInt(req.query.rows ?? '50', 10) || 50, 200);
      const page = Math.max(parseInt(req.query.page ?? '1', 10) || 1, 1);
      const offset = (page - 1) * limit;
      const rows = await db()
        .select({
          id: schema.auditLog.id,
          action: schema.auditLog.action,
          targetKind: schema.auditLog.targetKind,
          targetId: schema.auditLog.targetId,
          payload: schema.auditLog.payload,
          createdAt: schema.auditLog.createdAt,
        })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.actorUserId, user.id))
        .orderBy(desc(schema.auditLog.id))
        .limit(limit)
        .offset(offset);
      const [countRow] = await db()
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.actorUserId, user.id));
      const result = rows.map((r) => ({
        id: String(r.id),
        action: r.action,
        actor_id: user.id,
        target_kind: r.targetKind,
        target_id: r.targetId,
        metadata: r.payload,
        created_at: r.createdAt.toISOString(),
      }));
      return reply.send({ result, count: countRow?.count ?? result.length });
    },
  );

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
  // Feature 084 — list ALL organizations the caller is a member of (multi-org).
  app.get('/platform/organizations', async (req, reply) => {
    const user = app.requireAuth(req);
    const rows = await db()
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizations)
      .innerJoin(
        schema.organizationMembers,
        eq(schema.organizationMembers.organizationId, schema.organizations.id),
      )
      .where(eq(schema.organizationMembers.userId, user.id));
    return reply.send(rows.map((r) => buildOrg(r.id, r.name, r.role === 'owner')));
  });

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug', async (req, reply) => {
    const user = app.requireAuth(req);
    const [orgRow] = await db()
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizations)
      .innerJoin(
        schema.organizationMembers,
        eq(schema.organizationMembers.organizationId, schema.organizations.id),
      )
      .where(
        and(
          eq(schema.organizationMembers.userId, user.id),
          eq(schema.organizations.id, req.params.slug),
        ),
      )
      .limit(1);
    if (!orgRow) return reply.status(404).send({ error: 'Organization not found' });
    return reply.send(buildOrg(orgRow.id, orgRow.name, orgRow.role === 'owner'));
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
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return reply.status(400).send({ error: 'name required' });
    return reply.send({ name, plan: 'free', is_valid: true });
  });

  app.post('/platform/organizations/onboarding-survey', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  // Postgres versions list for project settings
  app.get('/platform/projects/available-versions', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([
      {
        postgres_engine: 'postgres',
        release_channel: 'ga',
        displayName: 'PostgreSQL 15',
        postgresVersion: '15.8.1.085',
      },
    ]);
  });

  // ── Create organization ────────────────────────────────────────────────────
  // Feature 084 (US3) — create a new organization; the creator becomes owner.
  // org.create is allowed for every authenticated role (no org context needed).
  app.post('/platform/organizations', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as { name?: string };
    const name = body.name?.trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    // Feature 086 — shared org-creation primitive (also used by /setup).
    const { id } = await db().transaction((tx) =>
      createOrganizationWithOwner(tx, { userId: user.id, name }),
    );
    return reply.status(201).send({ pending_payment_intent_secret: null, ...buildOrg(id, name, true) });
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

      const created = resp.json<{ ref: string; name: string; status: string; orgId?: string }>();
      const apex = process.env.SUPASTACK_APEX ?? '';
      const orgSlug = (body?.organization_slug as string) || user.id;
      const endpoint = apex ? `https://${created.ref}.${apex}` : '';
      return reply.status(201).send({
        id: hashRefToInt(created.ref),
        ref: created.ref,
        name: created.name,
        status: 'COMING_UP',
        cloud_provider: 'SUPASTACK',
        region: 'local',
        organization_id: orgSlug,
        organization_slug: orgSlug,
        inserted_at: new Date().toISOString(),
        is_branch_enabled: false,
        is_physical_backups_enabled: false,
        preview_branch_refs: [],
        subscription_id: null,
        anon_key: '',
        service_key: '',
        endpoint,
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

  // Feature 086 US6 — project lifecycle/health status (Studio polls this during
  // a restore). `running → ACTIVE_HEALTHY`, `restoring → RESTORING`, etc.
  app.get<RefParams>('/platform/projects/:ref/status', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .innerJoin(
        schema.organizationMembers,
        eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId),
      )
      .where(
        and(
          eq(schema.supabaseInstances.ref, req.params.ref),
          eq(schema.organizationMembers.userId, user.id),
        ),
      )
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send({
      status: toStudioProjectStatus(inst.status),
    });
  });

  app.patch<RefParams>('/platform/projects/:ref', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref, name: schema.supabaseInstances.name })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const newName = typeof body.name === 'string' ? body.name.trim() : inst.name;
    if (newName !== inst.name) {
      await db().update(schema.supabaseInstances).set({ name: newName }).where(eq(schema.supabaseInstances.ref, inst.ref));
    }
    return reply.send({ id: hashRefToInt(inst.ref), name: newName, ref: inst.ref });
  });

  // Databases

  app.get<RefParams>('/platform/projects/:ref/databases', async (req, reply) => {
    const user = app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    const [inst] = await db()
      .select({
        ref: schema.supabaseInstances.ref,
        portKong: schema.supabaseInstances.portKong,
        encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
        insertedAt: schema.supabaseInstances.createdAt,
      })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.send([]);
    const kongUrl = apex ? `https://${inst.ref}.${apex}` : `http://localhost:${inst.portKong}`;
    const dbHost = apex ? `db.${inst.ref}.${apex}` : 'localhost';
    let connectionString = '';
    if (inst.encryptedSecrets) {
      try {
        const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as { postgresPassword?: string };
        if (secrets.postgresPassword) {
          const pwd = encodeURIComponent(secrets.postgresPassword);
          connectionString = `postgresql://postgres:${pwd}@${dbHost}:5432/postgres`;
        }
      } catch { /* leave empty on decrypt failure */ }
    }
    return reply.send([{
      cloud_provider: 'SUPASTACK',
      connectionString,
      connection_string_read_only: null,
      db_host: dbHost,
      db_name: 'postgres',
      db_port: 5432,
      db_user: 'postgres',
      identifier: inst.ref,
      inserted_at: inst.insertedAt?.toISOString() ?? new Date().toISOString(),
      region: 'local',
      restUrl: `${kongUrl}`,
      size: 'micro',
      status: 'ACTIVE_HEALTHY',
    }]);
  });

  // Auth config — proxy to the auth-config management route internally
  // Studio (IS_PLATFORM) calls GET/PATCH /platform/auth/:ref/config with UPPERCASE
  // GoTrue-config field names (`EXTERNAL_GITHUB_ENABLED`); the Management API
  // /v1/projects/:ref/config/auth schema is `.strict()` lowercase snake_case.
  // Feature 085: translate at THIS edge only (auth-config-case.ts) — the /v1
  // contract stays untouched. Route the inject via `/v1` (NOT `/api/v1`) so the
  // mgmt error envelope surfaces validation 400s + `details` instead of the
  // generic 500 "internal error" the /api/v1 mount maps them to.
  const fwdHeaders = (req: { headers: unknown }): Record<string, string> => {
    const h = { ...(req.headers as Record<string, string>) };
    delete h['content-length']; // recomputed for the (re-keyed) payload
    return h;
  };
  // Translate any `details` map on an error envelope back to the Studio key space.
  const studioErr = (body: Record<string, unknown>): Record<string, unknown> => {
    if (body && typeof body.details === 'object' && body.details) {
      body.details = toStudioKeys(body.details as Record<string, unknown>);
    }
    return body;
  };
  const pickHooks = (cfg: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(cfg).filter(([k]) => k.startsWith('hook_')));

  app.get<RefParams>('/platform/auth/:ref/config', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/config/auth`, headers: fwdHeaders(req) });
    const body = resp.json<Record<string, unknown>>();
    return reply.status(resp.statusCode).send(resp.statusCode < 300 ? toStudioKeys(body) : body);
  });

  app.patch<RefParams>('/platform/auth/:ref/config', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${req.params.ref}/config/auth`,
      headers: fwdHeaders(req),
      payload: JSON.stringify(toApiKeys((req.body ?? {}) as Record<string, unknown>)),
    });
    const body = resp.json<Record<string, unknown>>();
    return reply.status(resp.statusCode).send(resp.statusCode >= 400 ? studioErr(body) : toStudioKeys(body));
  });

  // Auth Hooks (feature 085 + 082): a scoped view/write over the `hook_*` subset
  // of the auth config (same store as /config/auth → reuses feature 082's
  // pg-functions:// cross-field validation + the /v1 RBAC auth_config.read/write).
  app.get<RefParams>('/platform/auth/:ref/config/hooks', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/config/auth`, headers: fwdHeaders(req) });
    const body = resp.json<Record<string, unknown>>();
    return reply.status(resp.statusCode).send(resp.statusCode < 300 ? toStudioKeys(pickHooks(body)) : body);
  });

  app.patch<RefParams>('/platform/auth/:ref/config/hooks', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${req.params.ref}/config/auth`,
      headers: fwdHeaders(req),
      payload: JSON.stringify(toApiKeys((req.body ?? {}) as Record<string, unknown>)),
    });
    const body = resp.json<Record<string, unknown>>();
    return reply.status(resp.statusCode).send(resp.statusCode >= 400 ? studioErr(body) : toStudioKeys(pickHooks(body)));
  });

  // Billing addons
  app.get<RefParams>('/platform/projects/:ref/billing/addons', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ available_addons: [], selected_addons: [] });
  });

  // Storage config — persisted in project_config_snapshots (surface='storage')
  const STORAGE_CONFIG_DEFAULTS = { fileSizeLimit: 52428800, features: { imageTransformation: { enabled: true } } };

  async function loadStorageConfig(ref: string): Promise<typeof STORAGE_CONFIG_DEFAULTS> {
    const rows = await db()
      .select({ payload: schema.projectConfigSnapshots.encryptedPayload })
      .from(schema.projectConfigSnapshots)
      .where(
        and(
          eq(schema.projectConfigSnapshots.instanceRef, ref),
          eq(schema.projectConfigSnapshots.surface, 'storage'),
        ),
      )
      .limit(1);
    if (rows[0]) {
      return decryptJson<typeof STORAGE_CONFIG_DEFAULTS>(rows[0].payload, loadMasterKey());
    }
    return { ...STORAGE_CONFIG_DEFAULTS };
  }

  app.get<RefParams>('/platform/projects/:ref/config/storage', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(await loadStorageConfig(req.params.ref));
  });

  // PostgREST config — delegates to /v1 (which now returns jwt_secret) and adds
  // the platform-only fields db_anon_role + role_claim_key (GetPostgrestConfigResponse).
  app.get<RefParams>('/platform/projects/:ref/config/postgrest', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/postgrest`,
      headers: req.headers as Record<string, string>,
    });
    const base = resp.statusCode === 200
      ? resp.json<Record<string, unknown>>()
      : { db_schema: 'public,graphql_public', db_extra_search_path: 'public, extensions', max_rows: 1000, db_pool: null, jwt_secret: '' };
    return reply.send({ ...base, db_anon_role: 'anon', role_claim_key: '.role' });
  });

  app.patch<RefParams>('/platform/projects/:ref/config/postgrest', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${req.params.ref}/postgrest`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    if (resp.statusCode === 200) return reply.status(200).send(resp.json<unknown>());
    return reply.send(req.body ?? {});
  });

  // PgBouncer config — GET + PATCH both delegate to v1 (FR-009, FR-010)
  app.get<RefParams>('/platform/projects/:ref/config/pgbouncer', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/config/database/pgbouncer`,
      headers: fwdHeaders(req),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.patch<RefParams>('/platform/projects/:ref/config/pgbouncer', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${req.params.ref}/config/database/pooler`,
      headers: fwdHeaders(req),
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // Realtime config — delegates to v1 (FR-005, FR-006)
  app.get<RefParams>('/platform/projects/:ref/config/realtime', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/config/realtime`,
      headers: fwdHeaders(req),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.patch<RefParams>('/platform/projects/:ref/config/realtime', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${req.params.ref}/config/realtime`,
      headers: fwdHeaders(req),
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.get<RefParams>('/platform/projects/:ref/postgres-config', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/config/database/postgres`, headers: fwdHeaders(req) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.patch<RefParams>('/platform/projects/:ref/postgres-config', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'PATCH', url: `/v1/projects/${req.params.ref}/config/database/postgres`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // Pooling config — Supavisor endpoint for self-hosted
  app.get<RefParams>('/platform/projects/:ref/pooling', async (req, reply) => {
    app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    const poolerHost = apex ? `pooler.${apex}` : 'localhost';
    return reply.send({
      db_dns_name: poolerHost,
      db_host: poolerHost,
      db_port: 6543,
      default_pool_size: 15,
      max_client_conn: 200,
      pool_mode: 'transaction',
      server_idle_timeout: 600,
    });
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
    const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/postgrest`, headers: fwdHeaders(req) });
    if (resp.statusCode !== 200) return reply.status(resp.statusCode).send(resp.json<unknown>());
    const v1 = resp.json<{ db_schema?: string; db_extra_search_path?: string; max_rows?: number }>();
    return reply.send({
      endpoint: `${kongUrl}/rest/v1`,
      schema: v1.db_schema ?? 'public',
      extraSearchPath: (v1.db_extra_search_path ?? 'public,extensions').split(',').map((s) => s.trim()),
      maxRows: v1.max_rows ?? 1000,
    });
  });

  // Resource warnings
  app.get('/platform/projects-resource-warnings', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // Database config
  app.get<RefParams>('/platform/projects/:ref/config/database', async (req, reply) => {
    const user = app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send({
      db_host: apex ? `db.${inst.ref}.${apex}` : 'localhost',
      db_port: 5432,
      db_name: 'postgres',
      db_user: 'postgres',
      db_schema: 'public',
      max_rows: 1000,
    });
  });

  // Disk allocation
  app.get<RefParams>('/platform/projects/:ref/disk', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send({
      volume_size_gb: 8,
      volume_percentage: 0,
      remaining_volume_size: 8,
      projected_size_increase_gb: 0,
    });
  });

  // Network restrictions — none in self-hosted
  app.get<RefParams>('/platform/projects/:ref/network/restrictions', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send({
      db_allowed_cidrs: [],
      db_allowed_cidrs_public_access_enabled: false,
      entitlement: 'disallowed',
      override_enabled: false,
    });
  });

  // Services — list running per-instance services
  app.get<RefParams>('/platform/projects/:ref/services', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref, status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const svcStatus = inst.status === 'running' ? 'ACTIVE_HEALTHY' : toStudioProjectStatus(inst.status);
    return reply.send(['kong', 'auth', 'rest', 'storage', 'realtime', 'meta', 'functions', 'analytics', 'imgproxy', 'studio'].map((name) => ({ name, status: svcStatus })));
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
    // Feature 086 US6 — real backups in the vendored-Studio Cloud shape.
    const user = app.requireAuth(req);
    app.authorize(req, 'backup.list');
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .innerJoin(
        schema.organizationMembers,
        eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId),
      )
      .where(
        and(
          eq(schema.supabaseInstances.ref, req.params.ref),
          eq(schema.organizationMembers.userId, user.id),
        ),
      )
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send(await listBackupsForPlatform(req.params.ref));
  });

  app.get<RefParams>('/platform/database/:ref/backups/downloadable-backups', async (req, reply) => {
    app.requireAuth(req);
    const rows = await db()
      .select({
        seq: schema.backups.seq,
        startedAt: schema.backups.startedAt,
        completedAt: schema.backups.completedAt,
        sizeBytes: schema.backups.sizeBytes,
      })
      .from(schema.backups)
      .where(
        and(
          eq(schema.backups.instanceRef, req.params.ref),
          eq(schema.backups.status, 'completed'),
        ),
      )
      .orderBy(desc(schema.backups.startedAt));
    return reply.send({
      backups: rows.map((r) => ({
        id: Number(r.seq ?? 0),
        inserted_at: r.startedAt.toISOString(),
        completed_at: r.completedAt?.toISOString() ?? null,
        size_bytes: Number(r.sizeBytes ?? 0),
        isPhysicalBackup: true,
        status: 'COMPLETED',
      })),
    });
  });

  app.post<RefParams>('/platform/database/:ref/backups/download', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ url: null });
  });

  // Databases statuses (project home page)
  app.get<RefParams>('/platform/projects/:ref/databases-statuses', async (req, reply) => {
    // #106 — reflect the REAL instance status (e.g. RESTORING during a restore),
    // consistent with /platform/projects/:ref/status; org-membership scoped. Studio
    // consumes this in data/read-replicas/replicas-status-query.ts (per-database status).
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .innerJoin(
        schema.organizationMembers,
        eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId),
      )
      .where(
        and(
          eq(schema.supabaseInstances.ref, req.params.ref),
          eq(schema.organizationMembers.userId, user.id),
        ),
      )
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send([{ identifier: req.params.ref, status: toStudioProjectStatus(inst.status) }]);
  });

  // Content endpoints — shapes validated against Studio data fetchers
  // /content/folders: getSQLSnippetFolders expects data.data.{folders,contents} + data.cursor
  // SQL Snippets — real persistent store via sql_snippets + sql_snippet_folders tables
  function snippetRow(s: { id: string; name: string; description: string | null; content: string; visibility: string; folderId: string | null; ownerId: string | null; createdAt: Date; updatedAt: Date; instanceRef: string }) {
    return { id: s.id, name: s.name, description: s.description ?? '', sql: s.content, content: { sql: s.content, content_id: s.id, schema_version: '1.0' }, visibility: s.visibility, folder_id: s.folderId, owner_id: s.ownerId, project_id: s.instanceRef, favorite: false, inserted_at: s.createdAt?.toISOString(), updated_at: s.updatedAt?.toISOString(), type: 'sql' };
  }

  app.get<RefParams>('/platform/projects/:ref/content/folders', async (req, reply) => {
    const user = app.requireAuth(req);
    const ref = req.params.ref;
    const folders = await db()
      .select()
      .from(schema.sqlSnippetFolders)
      .where(and(eq(schema.sqlSnippetFolders.instanceRef, ref), eq(schema.sqlSnippetFolders.ownerId, user.id)));
    const snippets = await db()
      .select()
      .from(schema.sqlSnippets)
      .where(and(eq(schema.sqlSnippets.instanceRef, ref), eq(schema.sqlSnippets.ownerId, user.id)));
    return reply.send({ data: { folders, contents: snippets.map(snippetRow) }, cursor: null });
  });

  app.get<RefParams>('/platform/projects/:ref/content', async (req, reply) => {
    const user = app.requireAuth(req);
    const ref = req.params.ref;
    const rows = await db()
      .select()
      .from(schema.sqlSnippets)
      .where(and(eq(schema.sqlSnippets.instanceRef, ref), eq(schema.sqlSnippets.ownerId, user.id)));
    return reply.send({ data: rows.map(snippetRow), cursor: null });
  });

  app.get<RefParams>('/platform/projects/:ref/content/count', async (req, reply) => {
    const user = app.requireAuth(req);
    const ref = req.params.ref;
    const rows = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.sqlSnippets)
      .where(and(eq(schema.sqlSnippets.instanceRef, ref), eq(schema.sqlSnippets.ownerId, user.id)));
    return reply.send({ count: rows[0]?.count ?? 0 });
  });

  app.get<{ Params: { ref: string; id: string } }>(
    '/platform/projects/:ref/content/folders/:id',
    async (req, reply) => {
      app.requireAuth(req);
      const [folder] = await db()
        .select()
        .from(schema.sqlSnippetFolders)
        .where(eq(schema.sqlSnippetFolders.id, req.params.id))
        .limit(1);
      if (!folder) return reply.status(404).send({ error: 'Folder not found' });
      return reply.send(folder);
    },
  );

  app.post<RefParams>('/platform/projects/:ref/content', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const [inserted] = await db()
      .insert(schema.sqlSnippets)
      .values({
        instanceRef: req.params.ref,
        ownerId: user.id,
        name: typeof body.name === 'string' ? body.name : 'Untitled Query',
        description: typeof body.description === 'string' ? body.description : null,
        content: typeof body.sql === 'string' ? body.sql : (typeof (body.content as Record<string, unknown>)?.sql === 'string' ? String((body.content as Record<string, unknown>).sql) : ''),
        visibility: typeof body.visibility === 'string' ? body.visibility : 'user',
        folderId: typeof body.folder_id === 'string' ? body.folder_id : null,
      })
      .returning();
    return reply.status(201).send(snippetRow(inserted!));
  });

  app.get<{ Params: { ref: string; id: string } }>(
    '/platform/projects/:ref/content/item/:id',
    async (req, reply) => {
      app.requireAuth(req);
      const [row] = await db()
        .select()
        .from(schema.sqlSnippets)
        .where(eq(schema.sqlSnippets.id, req.params.id))
        .limit(1);
      if (!row) return reply.status(404).send({ error: 'not found' });
      return reply.send(snippetRow(row));
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

  // Project settings — Studio's project API/connection page. Wire-compatible with
  // Cloud's GET /platform/projects/:ref/settings: jwt_secret + service_api_keys
  // (anon + service_role) + db connection details. Org-membership scoped via the
  // join (a non-member sees no row → 404). Secrets come from encryptedSecrets.
  app.get<RefParams>('/platform/projects/:ref/settings', async (req, reply) => {
    const user = app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    const [inst] = await db()
      .select({
        ref: schema.supabaseInstances.ref,
        name: schema.supabaseInstances.name,
        status: schema.supabaseInstances.status,
        portKong: schema.supabaseInstances.portKong,
        encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
        insertedAt: schema.supabaseInstances.createdAt,
      })
      .from(schema.supabaseInstances)
      .innerJoin(
        schema.organizationMembers,
        eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId),
      )
      .where(
        and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)),
      )
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const secrets = inst.encryptedSecrets
      ? (decryptJson(inst.encryptedSecrets, loadMasterKey()) as {
          jwtSecret?: string;
          anonKey?: string;
          serviceRoleKey?: string;
        })
      : {};
    const kongBase = apex ? `https://${inst.ref}.${apex}` : `http://localhost:${inst.portKong}`;
    // storage_endpoint must be a bare hostname (no scheme, no path) — Studio prepends https:// itself
    // See: studio/data/config/project-endpoint-query.ts line ~41
    const storageHost = apex ? `${inst.ref}.${apex}` : `localhost:${inst.portKong}`;
    return reply.send({
      cloud_provider: 'SUPASTACK',
      region: 'local',
      db_dns_name: '',
      db_host: apex ? `db.${inst.ref}.${apex}` : 'localhost',
      db_ip_addr_config: 'ipv4',
      db_name: 'postgres',
      db_port: 5432,
      db_user: 'postgres',
      inserted_at: inst.insertedAt?.toISOString() ?? new Date().toISOString(),
      name: inst.name,
      ref: inst.ref,
      ssl_enforced: false,
      is_sensitive: null,
      status: toStudioProjectStatus(inst.status),
      app_config: {
        db_schema: 'public',
        endpoint: kongBase,
        storage_endpoint: storageHost,
      },
      jwt_secret: secrets.jwtSecret ?? '',
      service_api_keys: [
        { api_key: secrets.anonKey ?? '', name: 'anon key', tags: 'anon' },
        { api_key: secrets.serviceRoleKey ?? '', name: 'service_role key', tags: 'service_role' },
      ],
    });
  });

  // Project PATCH /settings — update project name (mirrors PATCH /platform/projects/:ref)
  app.patch<RefParams>('/platform/projects/:ref/settings', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref, name: schema.supabaseInstances.name })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== inst.name) {
      await db().update(schema.supabaseInstances).set({ name: body.name.trim() }).where(eq(schema.supabaseInstances.ref, inst.ref));
    }
    return reply.send({ id: hashRefToInt(inst.ref), ref: inst.ref, name: typeof body.name === 'string' ? body.name.trim() : inst.name });
  });

  // Members — real: org members who have access to this project
  app.get<RefParams>('/platform/projects/:ref/members', async (req, reply) => {
    app.requireAuth(req);
    const [inst] = await db()
      .select({ orgId: schema.supabaseInstances.orgId })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, req.params.ref))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const rows = await db()
      .select({ gotrueId: schema.organizationMembers.userId, role: schema.organizationMembers.role, email: schema.users.email })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(eq(schema.organizationMembers.organizationId, inst.orgId!));
    return reply.send(rows.map((r) => ({
      gotrue_id: r.gotrueId,
      primary_email: r.email,
      username: r.email.split('@')[0],
      role_ids: [ROLE_IDS[r.role as Role]],
      mfa_enabled: false,
      is_sso_user: false,
    })));
  });

  // Misc project stubs — key is always path.split('/').pop()
  for (const path of [
    '/platform/projects/:ref/infra-monitoring',
    '/platform/projects/:ref/config/pgbouncer/status',
    '/platform/projects/:ref/config/secrets/update-status',
    '/platform/projects/:ref/notifications/advisor/exceptions',
    '/platform/projects/:ref/load-balancers',
  ] as const) {
    app.get(path, async (req, reply) => {
      app.requireAuth(req);
      const stub: Record<string, unknown> = {
        'infra-monitoring': { data: [] },
        'config/pgbouncer/status': { active: true },
        'config/secrets/update-status': { updating: false },
        'notifications/advisor/exceptions': { result: [] },
        'load-balancers': [],
        'settings': {},
      };
      const key = path.split('/').pop()!;
      return reply.send(stub[key] ?? {});
    });
  }

  // pause/status — real DB state (T002)
  app.get<RefParams>('/platform/projects/:ref/pause/status', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status, updatedAt: schema.supabaseInstances.updatedAt })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send({
      initiated_at: inst.status === 'paused' ? inst.updatedAt.toISOString() : null,
      status: 'not_pausing',
    });
  });

  // run-lints — advisory lint queries via per-instance Postgres (T018)
  app.get<RefParams>('/platform/projects/:ref/run-lints', async (req, reply) => {
    app.requireAuth(req);
    try {
      const results = await withPerInstancePg(req.params.ref, async (pg) => {
        const out: Array<{ name: string; title: string; level: string; categories: string[]; description: string; detail: string; remediation: string; metadata: Record<string, unknown>; cache_key: string; facing: string }> = [];
        for (const [name, check] of Object.entries(LINT_CHECKS)) {
          const res = await pg.query(check.sql);
          for (const row of res.rows as Record<string, unknown>[]) {
            const metadata = check.mapRow(row);
            out.push({ name, title: check.title, level: check.level, categories: check.categories, description: check.description, detail: '', remediation: '', metadata, cache_key: `${name}-${JSON.stringify(metadata)}`, facing: 'EXTERNAL' });
          }
        }
        return out;
      });
      return reply.send(results);
    } catch (err) {
      if (err instanceof InstanceNotRunningError) {
        return reply.status(503).send({ error: 'Project is not running', code: 'project_not_running' });
      }
      throw err;
    }
  });

  // Completed backups available for physical restore — real data from backups table
  app.get<RefParams>('/platform/projects/:ref/restore/versions', async (req, reply) => {
    app.requireAuth(req);
    const rows = await db()
      .select({
        seq: schema.backups.seq,
        startedAt: schema.backups.startedAt,
        completedAt: schema.backups.completedAt,
        sizeBytes: schema.backups.sizeBytes,
      })
      .from(schema.backups)
      .where(
        and(
          eq(schema.backups.instanceRef, req.params.ref),
          eq(schema.backups.status, 'completed'),
        ),
      )
      .orderBy(desc(schema.backups.startedAt));
    return reply.send(
      rows.map((r) => ({
        id: Number(r.seq ?? 0),
        inserted_at: r.startedAt.toISOString(),
        completed_at: r.completedAt?.toISOString() ?? null,
        size_bytes: r.sizeBytes ?? null,
        isPhysicalBackup: true,
        status: 'COMPLETED',
      })),
    );
  });

  // Daily request/error counts — aggregate audit log events by day (last 30 days)
  app.get<RefParams>('/platform/projects/:ref/daily-stats', async (req, reply) => {
    app.requireAuth(req);
    const rows = await db().execute(
      sql`SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
                 count(*) AS total_requests
          FROM audit_log
          WHERE target_kind = 'project' AND target_id = ${req.params.ref}
            AND created_at >= now() - interval '30 days'
          GROUP BY 1
          ORDER BY 1 DESC`,
    );
    const rowArray = Array.isArray(rows) ? rows : ((rows as { rows?: unknown }).rows ?? []);
    return reply.send({
      data: (rowArray as Array<Record<string, unknown>>).map((r) => ({
        period_start: r['day'],
        total_requests: Number(r['total_requests'] ?? 0),
        errors: 0,
      })),
    });
  });

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
      // Feature 084 (US5) — projects belong to one org; require membership and
      // return ONLY this org's projects, paginated with a real total count.
      await app.authorizeOrg(req, 'instance.list', req.params.slug);
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
        .where(eq(schema.supabaseInstances.orgId, req.params.slug))
        .limit(limit)
        .offset(offset);

      const [countRow] = await db()
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.supabaseInstances)
        .where(eq(schema.supabaseInstances.orgId, req.params.slug));

      const projects = instances.map((inst) => buildProject(inst, apex));
      return reply.send({
        pagination: { count: countRow?.count ?? projects.length, limit, offset },
        projects,
      });
    },
  );

  // ── Org-scoped stubs ───────────────────────────────────────────────────────
  type SlugParams = { Params: { slug: string } };

  // Feature 084 (US4) — list org members with their role_ids.
  app.get<SlugParams>('/platform/organizations/:slug/members', async (req, reply) => {
    await app.authorizeOrg(req, 'member.list', req.params.slug);
    const rows = await db()
      .select({
        gotrueId: schema.organizationMembers.userId,
        role: schema.organizationMembers.role,
        email: schema.users.email,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.organizationMembers.userId))
      .where(eq(schema.organizationMembers.organizationId, req.params.slug));
    return reply.send(
      rows.map((r) => ({
        gotrue_id: r.gotrueId,
        primary_email: r.email,
        username: r.email.split('@')[0],
        role_ids: [ROLE_IDS[r.role as Role]],
        mfa_enabled: false,
        is_sso_user: false,
        metadata: {},
      })),
    );
  });

  // Feature 084 (US4) — the four fixed org roles as numeric-id objects.
  app.get<SlugParams>('/platform/organizations/:slug/roles', async (req, reply) => {
    await app.authorizeOrg(req, 'member.list', req.params.slug);
    const orgScopedRoles = (['owner', 'administrator', 'developer', 'read_only'] as Role[]).map(
      (r) => ({
        id: ROLE_IDS[r],
        name: ROLE_NAMES[r],
        description: null,
        base_role_id: ROLE_IDS[r],
        projects: [],
      }),
    );
    return reply.send({ org_scoped_roles: orgScopedRoles, project_scoped_roles: [] });
  });

  app.get<SlugParams>('/platform/organizations/:slug/billing/subscription', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ plan: { id: 'pro', name: 'Pro' }, tier: 'tier_payg', billing_via_partner: false, usage_billing_enabled: true, project_addons: [], addons: [] });
  });

  app.get<SlugParams>('/platform/organizations/:slug/billing/plans', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([{ id: 'pro', name: 'Pro' }]);
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

  app.get<SlugParams & { Querystring: { page?: string; rows?: string } }>(
    '/platform/organizations/:slug/audit',
    async (req, reply) => {
      await app.authorizeOrg(req, 'audit.read', req.params.slug);
      const limit = Math.min(parseInt(req.query.rows ?? '50', 10) || 50, 200);
      const page = Math.max(parseInt(req.query.page ?? '1', 10) || 1, 1);
      const offset = (page - 1) * limit;
      // Fetch refs of all instances in this org for cross-project audit coverage
      const instances = await db()
        .select({ ref: schema.supabaseInstances.ref })
        .from(schema.supabaseInstances)
        .where(eq(schema.supabaseInstances.orgId, req.params.slug));
      const instanceRefs = instances.map((i) => i.ref);
      // Match events where the target is the org itself OR one of its instances
      const targetIds = [req.params.slug, ...instanceRefs];
      const targetFilter = inArray(schema.auditLog.targetId, targetIds);
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
        .where(targetFilter)
        .orderBy(desc(schema.auditLog.id))
        .limit(limit)
        .offset(offset);
      const [countRow] = await db()
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.auditLog)
        .where(targetFilter);
      const result = rows.map((r) => ({
        id: String(r.id),
        action: r.action,
        actor_id: r.actorUserId,
        actor_email: r.actorEmail,
        target_kind: r.targetKind,
        target_id: r.targetId,
        metadata: r.payload,
        created_at: r.createdAt.toISOString(),
      }));
      return reply.send({ result, count: countRow?.count ?? result.length });
    },
  );

  // Feature 084 (US4) — pending invitations for the org.
  app.get<SlugParams>('/platform/organizations/:slug/members/invitations', async (req, reply) => {
    await app.authorizeOrg(req, 'member.list', req.params.slug);
    const rows = await db()
      .select({
        id: schema.organizationInvitations.id,
        email: schema.organizationInvitations.email,
        role: schema.organizationInvitations.role,
        createdAt: schema.organizationInvitations.createdAt,
      })
      .from(schema.organizationInvitations)
      .where(
        and(
          eq(schema.organizationInvitations.organizationId, req.params.slug),
          isNull(schema.organizationInvitations.consumedAt),
        ),
      );
    return reply.send({
      invitations: rows.map((r) => ({
        id: r.id,
        invited_email: r.email,
        invited_at: r.createdAt.toISOString(),
        role_id: ROLE_IDS[r.role as Role],
      })),
    });
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

  // Feature 084 (US4) — invitee checks an invite's validity before accepting.
  app.get<{ Params: { slug: string; token: string } }>(
    '/platform/organizations/:slug/members/invitations/:token',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const sha = hashInviteToken(req.params.token);
      const [inv] = await db()
        .select()
        .from(schema.organizationInvitations)
        .where(eq(schema.organizationInvitations.tokenSha256, sha))
        .limit(1);
      const [org] = await db()
        .select({ name: schema.organizations.name })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, req.params.slug))
        .limit(1);
      const orgName = org?.name ?? '';
      if (!inv || inv.organizationId !== req.params.slug) {
        return reply.send({
          authorized_user: false,
          email_match: false,
          expired_token: false,
          organization_name: orgName,
          sso_mismatch: false,
          token_does_not_exist: true,
        });
      }
      const emailMatch = user.email.toLowerCase() === inv.email.toLowerCase();
      return reply.send({
        authorized_user: emailMatch,
        email_match: emailMatch,
        expired_token: inv.consumedAt !== null || inv.expiresAt < new Date(),
        invite_id: inv.id,
        organization_name: orgName,
        sso_mismatch: false,
        token_does_not_exist: false,
      });
    },
  );

  // Feature 084 (US4) — accept an invitation (invitee is already a GoTrue user).
  app.post<{ Params: { slug: string; token: string } }>(
    '/platform/organizations/:slug/members/invitations/:token',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const sha = hashInviteToken(req.params.token);
      const [inv] = await db()
        .select()
        .from(schema.organizationInvitations)
        .where(
          and(
            eq(schema.organizationInvitations.tokenSha256, sha),
            isNull(schema.organizationInvitations.consumedAt),
          ),
        )
        .limit(1);
      if (!inv || inv.organizationId !== req.params.slug) {
        return reply.status(404).send({ error: 'invitation not found' });
      }
      if (inv.expiresAt < new Date()) {
        return reply.status(410).send({ error: 'invitation expired' });
      }
      await db().transaction(async (tx) => {
        await tx
          .insert(schema.organizationMembers)
          .values({ organizationId: inv.organizationId, userId: user.id, role: inv.role })
          .onConflictDoNothing();
        await tx
          .update(schema.organizationInvitations)
          .set({ consumedAt: new Date() })
          .where(eq(schema.organizationInvitations.id, inv.id));
      });
      return reply.send({});
    },
  );

  // Feature 084 (US4) — send invitations (emails[] + role_id). Email delivery via
  // the GoTrue mailer lands in US6; the invite token is the accept link for now.
  app.post<SlugParams>('/platform/organizations/:slug/members/invitations', async (req, reply) => {
    await app.authorizeOrg(req, 'member.invite', req.params.slug);
    // Feature 084 US6 (FR-031) — invitations are email-delivered; refuse clearly
    // when SMTP isn't configured rather than creating an undeliverable invite.
    if (!process.env.GOTRUE_SMTP_HOST) {
      return reply.status(409).send({ error: 'email delivery is not configured (SMTP)' });
    }
    const inviter = app.requireAuth(req);
    const body = (req.body ?? {}) as { emails?: string[]; role_id?: number };
    const emails = Array.isArray(body.emails) ? body.emails : [];
    const role = roleFromId(Number(body.role_id));
    if (!role) return reply.status(400).send({ error: 'invalid role_id' });
    const succeeded: string[] = [];
    const failed: { email: string; error: string }[] = [];
    for (const email of emails) {
      try {
        const { sha256, expiresAt } = newInviteToken();
        await db()
          .insert(schema.organizationInvitations)
          .values({
            organizationId: req.params.slug,
            email,
            tokenSha256: sha256,
            role,
            invitedByUserId: inviter.id,
            expiresAt,
          });
        succeeded.push(email);
      } catch (e) {
        failed.push({ email, error: (e as Error).message });
      }
    }
    return reply.send({ succeeded, failed });
  });

  // Feature 084 (US4) — cancel a pending invitation.
  app.delete<{ Params: { slug: string; id: string } }>(
    '/platform/organizations/:slug/members/invitations/:id',
    async (req, reply) => {
      await app.authorizeOrg(req, 'member.invite', req.params.slug);
      await db()
        .delete(schema.organizationInvitations)
        .where(
          and(
            eq(schema.organizationInvitations.id, req.params.id),
            eq(schema.organizationInvitations.organizationId, req.params.slug),
          ),
        );
      return reply.status(204).send();
    },
  );

  // Feature 084 (US4) — change a member's role (last-owner invariant).
  app.patch<{ Params: { slug: string; gotrue_id: string } }>(
    '/platform/organizations/:slug/members/:gotrue_id',
    async (req, reply) => {
      await app.authorizeOrg(req, 'member.update-role', req.params.slug);
      const body = (req.body ?? {}) as { role_id?: number };
      const newRole = roleFromId(Number(body.role_id));
      if (!newRole) return reply.status(400).send({ error: 'invalid role_id' });
      const current = await memberRole(req.params.slug, req.params.gotrue_id);
      if (!current) return reply.status(404).send({ error: 'member not found' });
      if (current === 'owner' && newRole !== 'owner' && (await ownerCount(req.params.slug)) <= 1) {
        return reply.status(409).send({ error: 'cannot demote the last owner' });
      }
      await db()
        .update(schema.organizationMembers)
        .set({ role: newRole })
        .where(
          and(
            eq(schema.organizationMembers.organizationId, req.params.slug),
            eq(schema.organizationMembers.userId, req.params.gotrue_id),
          ),
        );
      return reply.send({});
    },
  );

  // Feature 084 (US4) — remove a member (last-owner invariant).
  app.delete<{ Params: { slug: string; gotrue_id: string } }>(
    '/platform/organizations/:slug/members/:gotrue_id',
    async (req, reply) => {
      await app.authorizeOrg(req, 'member.remove', req.params.slug);
      const current = await memberRole(req.params.slug, req.params.gotrue_id);
      if (!current) return reply.status(204).send();
      if (current === 'owner' && (await ownerCount(req.params.slug)) <= 1) {
        return reply.status(409).send({ error: 'cannot remove the last owner' });
      }
      await db()
        .delete(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, req.params.slug),
            eq(schema.organizationMembers.userId, req.params.gotrue_id),
          ),
        );
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
    // Query real database size from the per-instance postgres
    try {
      const rows = await withPerInstancePg(req.params.ref, async (pgClient) => {
        const res = await pgClient.query(
          `SELECT pg_database_size(current_database()) AS db_size`,
        );
        return res.rows as Array<{ db_size: string }>;
      });
      const usageBytes = Number(rows[0]?.db_size ?? 0);
      return reply.send({ usage_bytes: usageBytes, total_bytes: 8589934592 });
    } catch {
      return reply.send({ usage_bytes: 0, total_bytes: 8589934592 });
    }
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

  app.delete<{ Params: { ref: string; aws_account_id: string } }>(
    '/platform/projects/:ref/privatelink/associations/aws-account/:aws_account_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
    },
  );

  // ── Advisor exceptions (lint suppression; no-op for self-hosted) ──────────
  app.post<RefParams>('/platform/projects/:ref/notifications/advisor/exceptions', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send(req.body ?? {});
  });

  app.delete<RefParams>('/platform/projects/:ref/notifications/advisor/exceptions', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.patch<{ Params: { ref: string; id: string } }>(
    '/platform/projects/:ref/notifications/advisor/exceptions/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send(req.body ?? {});
    },
  );

  // ── Billing addons write stubs ─────────────────────────────────────────────
  app.post<RefParams>('/platform/projects/:ref/billing/addons', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ message: 'Billing addons not supported on self-hosted' });
  });

  app.delete<{ Params: { ref: string; addon_variant: string } }>(
    '/platform/projects/:ref/billing/addons/:addon_variant',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(400).send({ message: 'Billing addons not supported on self-hosted' });
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

  app.post('/platform/feedback/docs', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.patch<{ Params: { conversation_id: string } }>(
    '/platform/feedback/conversations/:conversation_id/custom-fields',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(204).send();
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

  // Reset DB password — delegates to the existing pg-password-reset service
  app.patch<RefParams>('/platform/projects/:ref/db-password', async (req, reply) => {
    app.authorize(req, 'instance.pg-password.reset');
    const ref = req.params.ref;
    try {
      await resetPgPasswordForInstance(ref);
    } catch (err) {
      if (err instanceof InstanceNotFoundForResetError) return reply.status(404).send({ error: 'Project not found' });
      if (err instanceof InstanceNotResettableError) return reply.status(409).send({ error: err.message });
      if (err instanceof PerInstanceDbUnreachableError) return reply.status(502).send({ error: err.message });
      throw err;
    }
    return reply.status(200).send({ ref, message: 'Password reset successfully.' });
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
  app.get<RefParams>('/platform/replication/:ref/destinations-pipelines', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

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

  app.get<RefParams>('/platform/replication/:ref/tenants-sources', async (req, reply) => {
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
  app.post('/platform/signup', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({ error: 'email and password are required' });
    }
    try {
      const user = await signupGotrueUser({ email: body.email, password: body.password });
      await db().transaction((tx) =>
        createOrganizationWithOwner(tx, { userId: user.id, name: `${body.email!.split('@')[0]}'s org` }),
      );
      return reply.status(200).send({ id: user.id, email: user.email });
    } catch (err: unknown) {
      const e = err as { statusCode?: number; body?: string };
      if (e.statusCode === 422 || e.statusCode === 400) {
        return reply.status(400).send({ error: e.body ?? 'signup failed' });
      }
      throw err;
    }
  });

  // Feature 084 US6 — password reset via GoTrue's recovery mailer (needs SMTP).
  app.post('/platform/reset-password', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string };
    if (!body.email) return reply.status(400).send({ error: 'email is required' });
    if (!process.env.GOTRUE_SMTP_HOST) {
      return reply.status(409).send({ error: 'email delivery is not configured (SMTP)' });
    }
    try {
      await sendRecoveryEmail(body.email);
    } catch (err) {
      req.log.warn({ err }, 'reset-password: gotrue recover failed');
    }
    // Always 200 (don't leak whether the email exists).
    return reply.send({});
  });

  app.post('/platform/update-email', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as { new_email?: string };
    if (!body.new_email) return reply.status(400).send({ error: 'new_email is required' });
    try {
      const updated = await updateGotrueUser(user.id, { email: body.new_email });
      await db().update(schema.users).set({ email: updated.email }).where(eq(schema.users.id, user.id));
      return reply.send({ email: updated.email });
    } catch (err: unknown) {
      const e = err as { message?: string };
      return reply.status(422).send({ error: e.message ?? 'email update failed' });
    }
  });

  // PUT alias — Studio uses PUT, some paths use POST; both do the same thing.
  app.put('/platform/update-email', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as { new_email?: string };
    if (!body.new_email) return reply.status(400).send({ error: 'new_email is required' });
    try {
      const updated = await updateGotrueUser(user.id, { email: body.new_email });
      await db().update(schema.users).set({ email: updated.email }).where(eq(schema.users.id, user.id));
      return reply.send({ email: updated.email });
    } catch (err: unknown) {
      const e = err as { message?: string };
      return reply.status(422).send({ error: e.message ?? 'email update failed' });
    }
  });

  // Workflow runs — Cloud-only orchestration; return empty lists here.
  app.get('/platform/workflow-runs', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<{ Params: { workflow_run_id: string } }>(
    '/platform/workflow-runs/:workflow_run_id/logs',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ logs: [] });
    },
  );

  // Vercel redirect — Cloud integration only; return a stub redirect.
  app.get<{ Params: { installation_id: string } }>(
    '/platform/vercel/redirect/:installation_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(400).send({ error: 'Vercel integration is not supported on self-hosted' });
    },
  );

  // Cloud Marketplace buyer endpoints — AWS/GCP marketplace only.
  app.get<{ Params: { buyer_id: string } }>(
    '/platform/cloud-marketplace/buyers/:buyer_id/contract-linking-eligibility',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ eligible: false, reason: 'not_applicable' });
    },
  );

  app.get<{ Params: { buyer_id: string } }>(
    '/platform/cloud-marketplace/buyers/:buyer_id/onboarding-info',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(404).send({ error: 'No marketplace onboarding info available' });
    },
  );

  // Dynamic OAuth client registration (RFC-7591) — not supported on self-hosted.
  app.post('/platform/oauth/apps/register', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(501).send({ error: 'Dynamic OAuth client registration is not supported on self-hosted' });
  });

  // CLI login session creation — Studio (IS_PLATFORM) calls /platform/cli/login;
  // delegate to the actual implementation at /api/v1/cli/login (feature 011).
  app.post('/platform/cli/login', async (req, reply) => {
    app.requireAuth(req);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      headers: { ...(req.headers as Record<string, string>), 'content-length': undefined as unknown as string },
      payload: req.body as Record<string, unknown>,
    });
    return reply.status(res.statusCode).send(res.json());
  });

  // Feature 084 (US3) — rename an organization (display name only; ref is immutable).
  app.patch<SlugParams>('/platform/organizations/:slug', async (req, reply) => {
    const role = await app.authorizeOrg(req, 'org.update', req.params.slug);
    const body = (req.body ?? {}) as { name?: string };
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return reply.status(400).send({ error: 'name cannot be empty' });
      await db()
        .update(schema.organizations)
        .set({ name })
        .where(eq(schema.organizations.id, req.params.slug));
    }
    const [row] = await db()
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, req.params.slug))
      .limit(1);
    if (!row) return reply.status(404).send({ error: 'Organization not found' });
    return reply.send(buildOrg(row.id, row.name, role === 'owner'));
  });

  // Feature 084 (US3) — delete an organization (owner only; refused if it owns projects).
  app.delete<SlugParams>('/platform/organizations/:slug', async (req, reply) => {
    await app.authorizeOrg(req, 'org.delete', req.params.slug);
    const [proj] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.orgId, req.params.slug))
      .limit(1);
    if (proj) {
      return reply
        .status(409)
        .send({ error: 'Organization still owns projects; delete them first' });
    }
    await db().delete(schema.organizations).where(eq(schema.organizations.id, req.params.slug));
    return reply.status(204).send();
  });

  // Organization available Postgres versions
  app.get<SlugParams>('/platform/organizations/:slug/available-versions', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([
      {
        postgres_engine: 'postgres',
        release_channel: 'ga',
        displayName: 'PostgreSQL 15',
        postgresVersion: '15.8.1.085',
      },
    ]);
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

  app.get('/platform/plans', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([{ id: 'free', name: 'Free', is_free_tier: true, price: 0, price_description: '$0/month' }]);
  });

  app.get('/platform/status', async (req, reply) => {
    return reply.send({ title: 'Supastack', status: 'operational', indicator: 'none', incidents: [] });
  });

  // Marketplace / confirm-subscription stubs (cloud-only)
  app.post('/platform/organizations/cloud-marketplace', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Not available on self-hosted' });
  });

  app.post('/platform/organizations/confirm-subscription', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Not available on self-hosted' });
  });

  // Database backup operations not yet wired to the backup service
  app.post<RefParams>('/platform/database/:ref/backups/restore', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ status: 'restoring' });
  });

  app.post<RefParams>('/platform/database/:ref/backups/restore-physical', async (req, reply) => {
    // Feature 086 US6 — real physical restore via the existing engine + worker.
    const user = app.requireAuth(req);
    app.authorize(req, 'backup.restore');
    const ref = req.params.ref;
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .innerJoin(
        schema.organizationMembers,
        eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId),
      )
      .where(
        and(eq(schema.supabaseInstances.ref, ref), eq(schema.organizationMembers.userId, user.id)),
      )
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });

    const body = (req.body ?? {}) as { id?: number };
    if (typeof body.id !== 'number') {
      return reply.status(400).send({ error: 'id (number) is required' });
    }
    // Ref-scoped resolve — NEVER a global seq lookup (prevents cross-project restore IDOR).
    const uuid = await resolveBackupSeq(ref, body.id);
    if (!uuid) return reply.status(404).send({ error: 'Backup not found for this project' });

    try {
      const job = await initiateRestore(ref, { backup_id: uuid });
      await enqueueRestore(job.restore_job_id);
    } catch (err) {
      if (err instanceof RestoreError) {
        const status =
          err.code === 'backup_blob_missing' ? 410 : err.code === 'invalid_target' ? 400 : 409;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr?.code === '23505' && pgErr?.constraint?.includes('uq_restore_jobs_one_inflight')) {
        return reply
          .status(409)
          .send({ error: 'A restore is already in progress', code: 'restore_in_progress' });
      }
      throw err;
    }
    return reply.status(201).send();
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
    try {
      await withPerInstancePg(req.params.ref, async (pgClient) => {
        await pgClient.query(`CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions`);
        await pgClient.query(`GRANT USAGE ON SCHEMA net TO postgres, authenticated, service_role`);
      });
    } catch {
      // Extension may not be available or already enabled — not fatal
    }
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

  // ── Additional org endpoints ──────────────────────────────────────────────

  type OrgDrainParams = { Params: { slug: string; token: string } };

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug/analytics/audit-log-drains', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<{ Params: { slug: string } }>('/platform/organizations/:slug/analytics/audit-log-drains', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ token: 'stub', ...((req.body as Record<string, unknown>) ?? {}) });
  });

  app.delete<OrgDrainParams>('/platform/organizations/:slug/analytics/audit-log-drains/:token', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.patch<OrgDrainParams>('/platform/organizations/:slug/analytics/audit-log-drains/:token', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.put<OrgDrainParams>('/platform/organizations/:slug/analytics/audit-log-drains/:token', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.post<{ Params: { slug: string } }>('/platform/organizations/:slug/apps', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ id: 'mock-app', ...((req.body as Record<string, unknown>) ?? {}) });
  });

  app.get<{ Params: { slug: string; id: string } }>('/platform/organizations/:slug/apps/installations/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ id: req.params.id });
  });

  app.patch<{ Params: { slug: string; id: string } }>('/platform/organizations/:slug/apps/installations/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.get<{ Params: { slug: string; app_id: string } }>('/platform/organizations/:slug/apps/:app_id/signing-keys', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.put<{ Params: { slug: string; id: string } }>('/platform/organizations/:slug/oauth/apps/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.get<{ Params: { slug: string; app_id: string } }>('/platform/organizations/:slug/oauth/apps/:app_id/client-secrets', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<{ Params: { slug: string; id: string } }>('/platform/organizations/:slug/oauth/authorizations/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send({});
  });

  app.delete<{ Params: { slug: string; id: string } }>('/platform/organizations/:slug/oauth/authorizations/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.put<{ Params: { slug: string; gotrue_id: string; role_id: string } }>(
    '/platform/organizations/:slug/members/:gotrue_id/roles/:role_id',
    async (req, reply) => {
      await app.authorizeOrg(req, 'member.update-role', req.params.slug);
      const newRole = roleFromId(Number(req.params.role_id));
      if (!newRole) return reply.status(400).send({ error: 'invalid role_id' });
      const current = await memberRole(req.params.slug, req.params.gotrue_id);
      if (!current) return reply.status(404).send({ error: 'member not found' });
      if (current === 'owner' && newRole !== 'owner' && (await ownerCount(req.params.slug)) <= 1) {
        return reply.status(409).send({ error: 'cannot demote the last owner' });
      }
      await db()
        .update(schema.organizationMembers)
        .set({ role: newRole })
        .where(
          and(
            eq(schema.organizationMembers.organizationId, req.params.slug),
            eq(schema.organizationMembers.userId, req.params.gotrue_id),
          ),
        );
      return reply.status(200).send({});
    },
  );

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug/billing/invoices/upcoming', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ total: 0, lines: [] });
  });

  app.get<{ Params: { slug: string; id: string } }>('/platform/organizations/:slug/billing/invoices/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(404).send({ error: 'Invoice not found' });
  });

  app.get<{ Params: { slug: string; id: string } }>('/platform/organizations/:slug/billing/invoices/:id/payment-link', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ url: null });
  });

  app.get<{ Params: { slug: string; id: string } }>('/platform/organizations/:slug/billing/invoices/:id/receipt', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ url: null });
  });

  app.put<{ Params: { slug: string } }>('/platform/organizations/:slug/billing/subscription', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ plan: { id: 'pro', name: 'Pro' } });
  });

  app.post<{ Params: { slug: string } }>('/platform/organizations/:slug/billing/subscription/preview', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ breakdown: [], plan: { id: 'pro', name: 'Pro' } });
  });

  app.post<{ Params: { slug: string } }>('/platform/organizations/:slug/billing/credits/preview', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ preview_amount: 0 });
  });

  app.post<{ Params: { slug: string } }>('/platform/organizations/:slug/billing/credits/redeem', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Not available on self-hosted' });
  });

  app.post<{ Params: { slug: string } }>('/platform/organizations/:slug/billing/credits/top-up', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Not available on self-hosted' });
  });

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug/customer', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ billing_email: null, address: null });
  });

  app.put<{ Params: { slug: string } }>('/platform/organizations/:slug/customer', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug/payments', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ data: [] });
  });

  app.delete<{ Params: { slug: string } }>('/platform/organizations/:slug/payments', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.put<{ Params: { slug: string } }>('/platform/organizations/:slug/payments/default', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({});
  });

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug/tax-ids', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.put<{ Params: { slug: string } }>('/platform/organizations/:slug/tax-ids', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.delete<{ Params: { slug: string } }>('/platform/organizations/:slug/tax-ids', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  for (const docPath of [
    '/platform/organizations/:slug/documents/dpa-signed',
    '/platform/organizations/:slug/documents/iso27001-certificate',
    '/platform/organizations/:slug/documents/soc2-type-2-report',
    '/platform/organizations/:slug/documents/standard-security-questionnaire',
  ] as const) {
    app.get(docPath, async (req, reply) => {
      app.requireAuth(req);
      return reply.send({ signed: false, url: null });
    });
  }

  app.post<{ Params: { slug: string } }>('/platform/organizations/:slug/documents/dpa', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Not available on self-hosted' });
  });

  app.put<{ Params: { slug: string } }>('/platform/organizations/:slug/cloud-marketplace/link', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Not available on self-hosted' });
  });

  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug/cloud-marketplace/redirect', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ url: null });
  });

  // ── Missing project endpoints ─────────────────────────────────────────────
  app.patch<RefParams>('/platform/projects/:ref/config/storage', async (req, reply) => {
    app.requireAuth(req);
    const ref = req.params.ref;
    const current = await loadStorageConfig(ref);
    const body = (req.body ?? {}) as Partial<typeof STORAGE_CONFIG_DEFAULTS>;
    const merged = { ...current, ...body };
    const payload = encryptJson(merged, loadMasterKey());
    const existing = await db()
      .select({ id: schema.projectConfigSnapshots.id })
      .from(schema.projectConfigSnapshots)
      .where(
        and(
          eq(schema.projectConfigSnapshots.instanceRef, ref),
          eq(schema.projectConfigSnapshots.surface, 'storage'),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await db()
        .update(schema.projectConfigSnapshots)
        .set({ encryptedPayload: payload, updatedAt: new Date() })
        .where(eq(schema.projectConfigSnapshots.id, existing[0].id));
    } else {
      await db().insert(schema.projectConfigSnapshots).values({
        instanceRef: ref,
        surface: 'storage',
        encryptedPayload: payload,
      });
    }
    return reply.send(merged);
  });

  // DELETE /content — delete a snippet by id (passed as ?id= query or body.id)
  app.delete<RefParams>('/platform/projects/:ref/content', async (req, reply) => {
    const user = app.requireAuth(req);
    const id = (req.query as Record<string, string>).id ?? (req.body as Record<string, unknown> | undefined)?.id;
    if (typeof id === 'string') {
      await db().delete(schema.sqlSnippets).where(and(eq(schema.sqlSnippets.id, id), eq(schema.sqlSnippets.ownerId, user.id)));
    }
    return reply.status(200).send({});
  });

  // PUT /content — update a snippet (body must include id)
  app.put<RefParams>('/platform/projects/:ref/content', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.id === 'string') {
      const sqlVal = typeof body.sql === 'string' ? body.sql : (typeof (body.content as Record<string, unknown>)?.sql === 'string' ? String((body.content as Record<string, unknown>).sql) : '');
      const [upserted] = await db()
        .insert(schema.sqlSnippets)
        .values({
          id: body.id as string,
          instanceRef: req.params.ref,
          ownerId: user.id,
          name: typeof body.name === 'string' ? body.name : 'Untitled Query',
          description: typeof body.description === 'string' ? body.description : null,
          content: sqlVal,
          visibility: typeof body.visibility === 'string' ? body.visibility : 'user',
          folderId: typeof body.folder_id === 'string' ? body.folder_id : null,
        })
        .onConflictDoUpdate({
          target: schema.sqlSnippets.id,
          set: {
            name: sql`EXCLUDED.name`,
            description: sql`EXCLUDED.description`,
            content: sql`EXCLUDED.content`,
            visibility: sql`EXCLUDED.visibility`,
            folderId: sql`EXCLUDED.folder_id`,
            updatedAt: new Date(),
          },
        })
        .returning();
      return reply.send(snippetRow(upserted!));
    }
    return reply.send(body);
  });

  // POST /content/folders — create a folder
  app.post<RefParams>('/platform/projects/:ref/content/folders', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const [folder] = await db()
      .insert(schema.sqlSnippetFolders)
      .values({
        instanceRef: req.params.ref,
        ownerId: user.id,
        name: typeof body.name === 'string' ? body.name : 'New Folder',
        parentId: typeof body.parent_id === 'string' ? body.parent_id : null,
      })
      .returning();
    return reply.status(201).send(folder!);
  });

  // DELETE /content/folders — delete folder by id query param
  app.delete<RefParams>('/platform/projects/:ref/content/folders', async (req, reply) => {
    const user = app.requireAuth(req);
    const id = (req.query as Record<string, string>).id;
    if (typeof id === 'string') {
      await db().delete(schema.sqlSnippetFolders).where(and(eq(schema.sqlSnippetFolders.id, id), eq(schema.sqlSnippetFolders.ownerId, user.id)));
    }
    return reply.status(200).send({});
  });

  // PATCH /content/folders/:id — rename a folder
  app.patch<{ Params: { ref: string; id: string } }>('/platform/projects/:ref/content/folders/:id', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.name === 'string') {
      await db().update(schema.sqlSnippetFolders).set({ name: body.name, updatedAt: new Date() }).where(and(eq(schema.sqlSnippetFolders.id, req.params.id), eq(schema.sqlSnippetFolders.ownerId, user.id)));
    }
    return reply.send({ id: req.params.id, ...body });
  });

  // run-lints/:name — filter to single named check (T019)
  app.get<{ Params: { ref: string; name: string } }>('/platform/projects/:ref/run-lints/:name', async (req, reply) => {
    app.requireAuth(req);
    const check = LINT_CHECKS[req.params.name];
    if (!check) return reply.send([]);
    try {
      const results = await withPerInstancePg(req.params.ref, async (pg) => {
        const res = await pg.query(check.sql);
        return (res.rows as Record<string, unknown>[]).map((row) => ({
          name: req.params.name,
          title: check.title,
          level: check.level,
          description: check.description,
          metadata: check.mapRow(row),
        }));
      });
      return reply.send(results);
    } catch (err) {
      if (err instanceof InstanceNotRunningError) {
        return reply.status(503).send({ error: 'Project is not running', code: 'project_not_running' });
      }
      throw err;
    }
  });

  app.post<{
    Params: { ref: string };
    Querystring: { authorization_exp?: string; claims?: string };
  }>('/platform/projects/:ref/api-keys/temporary', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ encryptedSecrets: schema.supabaseInstances.encryptedSecrets })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const secrets = inst.encryptedSecrets
      ? (decryptJson(inst.encryptedSecrets, loadMasterKey()) as { jwtSecret?: string; serviceRoleKey?: string })
      : {};
    const jwtSecret = secrets.jwtSecret ?? '';
    const expSec = parseInt(req.query.authorization_exp ?? '3600', 10);
    let role = 'service_role';
    try {
      const parsed = JSON.parse(req.query.claims ?? '{}');
      if (parsed.role) role = parsed.role;
    } catch { /* use default */ }
    const safeRole = role === 'anon' ? 'anon' : 'service_role';
    const api_key = signSupabaseJwt(jwtSecret, { role: safeRole, expSec });
    return reply.status(201).send({ api_key });
  });

  app.post<RefParams>('/platform/projects/:ref/api/graphql', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ encryptedSecrets: schema.supabaseInstances.encryptedSecrets })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const secrets = inst.encryptedSecrets
      ? (decryptJson(inst.encryptedSecrets, loadMasterKey()) as { serviceRoleKey?: string })
      : {};
    const { resolveInstance, proxyToKong } = await import('../services/platform-proxy-helpers.js');
    try {
      const instance = await resolveInstance(req.params.ref);
      const bodyBuf = req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.alloc(0);
      const headers: Record<string, string | string[] | undefined> = {
        ...req.headers,
        apikey: secrets.serviceRoleKey ?? '',
        authorization: `Bearer ${secrets.serviceRoleKey ?? ''}`,
        'content-type': 'application/json',
      };
      delete headers['content-length'];
      const result = await proxyToKong(instance.portKong, '/graphql/v1', req.method, headers, bodyBuf);
      for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
      return reply.status(result.status).send(result.body);
    } catch {
      return reply.status(503).send({ error: 'GraphQL not available' });
    }
  });

  app.post<RefParams>('/platform/projects/:ref/config/realtime/shutdown', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(200).send({});
  });

  app.get<RefParams>('/platform/projects/:ref/config/supavisor', async (req, reply) => {
    app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? '';
    return reply.send({
      db_host: apex ? `pooler.${apex}` : 'localhost',
      db_port: 6543,
      db_user: 'postgres',
      pool_mode: 'transaction',
      default_pool_size: 15,
      max_client_conn: 200,
      ignore_startup_parameters: 'extra_float_digits',
      connection_string: apex
        ? `postgresql://postgres.${req.params.ref}:[YOUR-PASSWORD]@pooler.${apex}:6543/postgres`
        : `postgresql://postgres@localhost:6543/postgres`,
    });
  });

  app.get<{ Params: { ref: string; template: string } }>('/platform/auth/:ref/templates/:template', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/config/auth`,
      headers: req.headers as Record<string, string>,
    });
    if (resp.statusCode !== 200) return reply.status(resp.statusCode).send(resp.json<unknown>());
    const config = resp.json<Record<string, unknown>>();
    const t = req.params.template;
    return reply.send({
      subject: config[`mailer_subjects_${t}`] ?? '',
      content_path: '',
      template: config[`mailer_templates_${t}_content`] ?? '',
    });
  });

  app.post<RefParams>('/platform/projects/:ref/transfer/preview', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ eligible: false, errors: ['Transfer not supported on self-hosted'] });
  });

  app.get<RefParams>('/platform/database/:ref/clone', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<RefParams>('/platform/database/:ref/clone/status', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ status: 'idle' });
  });

  app.get<ReplicationDestParams>('/platform/replication/:ref/destinations/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ id: req.params.id });
  });

  app.post<ReplicationDestParams>('/platform/replication/:ref/destinations/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.get<ReplicationPipelineParams>('/platform/replication/:ref/pipelines/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ id: req.params.id });
  });

  app.post<ReplicationPipelineParams>('/platform/replication/:ref/pipelines/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.post<ReplicationPipelineParams>('/platform/replication/:ref/pipelines/:id/version', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ version: '1.0.0' });
  });

  app.post<RefParams>('/platform/replication/:ref/sources', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ id: 'mock-source', ...((req.body as Record<string, unknown>) ?? {}) });
  });

  app.post<ReplicationSourcePubParams>(
    '/platform/replication/:ref/sources/:source_id/publications/:name',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send(req.body ?? {});
    },
  );

  app.post<ReplicationDestPipelineParams>(
    '/platform/replication/:ref/destinations-pipelines/:did/:pid',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send(req.body ?? {});
    },
  );

  app.post('/platform/integrations/github/authorization', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'GitHub integration not available on self-hosted' });
  });

  app.delete('/platform/integrations/github/authorization', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.post('/platform/integrations/github/connections', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'GitHub integration not available on self-hosted' });
  });

  app.delete<{ Params: { id: string } }>('/platform/integrations/github/connections/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  app.patch<{ Params: { id: string } }>('/platform/integrations/github/connections/:id', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  app.patch<LogDrainParams>('/platform/projects/:ref/analytics/log-drains/:token', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // ── Missing org billing/addons, customer, payments ─────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/billing/addons', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ available_addons: [], selected_addons: [] });
  });

  app.get<SlugParams>('/platform/organizations/:slug/billing/customer', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ balance: 0, currency: 'usd', name: null, email: null });
  });

  app.get<SlugParams>('/platform/organizations/:slug/billing/payments', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<SlugParams>('/platform/organizations/:slug/billing/payments/setup-intent', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ client_secret: null });
  });

  // ── Missing org/projects/usage ──────────────────────────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/projects/usage', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Missing org integrations ────────────────────────────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/integrations', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Network restrictions — delegate to /v1 (T013) ────────────────────────
  app.get<RefParams>('/platform/projects/:ref/network-restrictions', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/network-restrictions`, headers: fwdHeaders(req) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.post<RefParams>('/platform/projects/:ref/network-restrictions/apply', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'POST', url: `/v1/projects/${req.params.ref}/network-restrictions/apply`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.get<RefParams>('/platform/projects/:ref/custom-hostname', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ customHostname: null, status: 'not_configured' });
  });

  app.post<RefParams>('/platform/projects/:ref/custom-hostname', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(409).send({ error: 'Custom hostnames are not supported on self-hosted' });
  });

  app.delete<RefParams>('/platform/projects/:ref/custom-hostname', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(204).send();
  });

  // ── SSL enforcement — delegate to /v1 (T014) ─────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/ssl-enforcement', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/ssl-enforcement`, headers: fwdHeaders(req) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.put<RefParams>('/platform/projects/:ref/ssl-enforcement', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'PUT', url: `/v1/projects/${req.params.ref}/ssl-enforcement`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // ── Missing database/extensions proxy ──────────────────────────────────────
  // Delegates to pg-meta via Kong, same pattern as /v1/ routes
  app.get<RefParams>('/platform/projects/:ref/database/extensions', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/platform/pg-meta/${req.params.ref}/extensions`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.post<RefParams>('/platform/projects/:ref/database/extensions', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/platform/pg-meta/${req.params.ref}/extensions`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.delete<{ Params: { ref: string; id: string } }>('/platform/projects/:ref/database/extensions/:id', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'DELETE',
      url: `/platform/pg-meta/${req.params.ref}/extensions?id=${req.params.id}`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // ── Project health / live status ─────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/health', async (req, reply) => {
    app.requireAuth(req);
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, req.params.ref))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const healthy = inst.status === 'running';
    const svc = (name: string) => ({ name, healthy, status: healthy ? 'ACTIVE_HEALTHY' : 'UNHEALTHY' });
    return reply.send([
      svc('db'),
      svc('gotrue'),
      svc('realtime'),
      svc('storage'),
      svc('rest'),
      svc('functions'),
    ]);
  });

  app.get<RefParams>('/platform/projects/:ref/live', async (req, reply) => {
    app.requireAuth(req);
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, req.params.ref))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send({ is_live: inst.status === 'running' });
  });

  // ── PostgREST project config (Studio API settings page) ──────────────────
  app.get<RefParams>('/platform/projects/:ref/postgrest', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/postgrest`,
      headers: req.headers as Record<string, string>,
    });
    if (resp.statusCode === 200) return reply.status(200).send(resp.json<unknown>());
    return reply.send({ db_schema: 'public,graphql_public', db_extra_search_path: 'public,extensions', max_rows: 1000, db_pool: null, jwt_secret: '' });
  });

  // ── Pooling/tenant config (Studio Database → Connection Pooling) ──────────
  app.get<RefParams>('/platform/projects/:ref/pooling-config', async (req, reply) => {
    app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? 'localhost';
    return reply.send({
      db_user: 'postgres',
      db_host: `pooler.${apex}`,
      db_port: 6543,
      default_pool_size: 15,
      pool_mode: 'transaction',
      pgbouncer_enabled: true,
    });
  });

  app.get<RefParams>('/platform/projects/:ref/tenant', async (req, reply) => {
    app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? 'localhost';
    return reply.send({
      db_user: 'postgres',
      db_host: `pooler.${apex}`,
      db_port: 6543,
      pool_mode: 'transaction',
      pgbouncer_enabled: true,
    });
  });

  // ── Read-only mode — reflects paused state (T003/T004) ──────────────────
  app.get<RefParams>('/platform/projects/:ref/readonly', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send({ enabled: inst.status === 'paused' });
  });

  app.delete<RefParams>('/platform/projects/:ref/readonly', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/v1/projects/${req.params.ref}/restore`,
      headers: { authorization: req.headers['authorization'] as string },
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // ── Compute resources list (Studio Infrastructure page) ──────────────────
  app.get<RefParams>('/platform/projects/:ref/resources', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([
      {
        id: 'compute',
        type: 'compute',
        name: 'Nano',
        description: 'Shared CPU, 512 MB RAM',
        price: 0,
        price_interval: 'month',
        price_unit: 'project',
      },
    ]);
  });

  // ── DB usage stats (Studio Database → Disk management) ───────────────────
  app.get<RefParams>('/platform/database/:ref/usage', async (req, reply) => {
    app.requireAuth(req);
    try {
      const rows = await withPerInstancePg(req.params.ref, async (pg) => {
        const res = await pg.query(`SELECT pg_database_size(current_database()) AS db_size`);
        return res.rows as Array<{ db_size: string }>;
      });
      const usedBytes = Number(rows[0]?.db_size ?? 0);
      return reply.send({
        db_size: { usage: usedBytes, limit: 536870912, cost: 0 },
        db_egress: { usage: 0, limit: 2147483648, cost: 0 },
        monthly_active_users: { usage: 0, limit: 50000, cost: 0 },
        monthly_active_sso_users: { usage: 0, limit: 0, cost: 0 },
        function_invocations: { usage: 0, limit: 500000, cost: 0 },
        function_count: { usage: 0, limit: 10, cost: 0 },
        realtime_peak_connection: { usage: 0, limit: 200, cost: 0 },
        storage_size: { usage: 0, limit: 1073741824, cost: 0 },
        storage_image_transformations: { usage: 0, limit: 100, cost: 0 },
        storage_egress: { usage: 0, limit: 2147483648, cost: 0 },
      });
    } catch {
      return reply.send({ db_size: { usage: 0, limit: 536870912, cost: 0 } });
    }
  });

  // ── Migration list proxy (delegates to /v1 migrations endpoint) ──────────
  app.get<RefParams>('/platform/database/:ref/migrations', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/database/migrations`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // ── Project-level billing stubs (cloud-only — return free-tier shapes) ───
  app.get<RefParams>('/platform/projects/:ref/billing/subscription', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({
      plan: { id: 'free', name: 'Free', payment_method_type: null },
      billing_via_partner: false,
      scheduled_plan_change: null,
      addons: [],
    });
  });

  app.put<RefParams>('/platform/projects/:ref/billing/subscription', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Billing not available on self-hosted' });
  });

  app.post<RefParams>('/platform/projects/:ref/billing/subscription/preview', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ breakdown: [], plan: { id: 'free', name: 'Free' } });
  });

  app.get<RefParams>('/platform/projects/:ref/billing/project-add-ons', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ selected_addons: [], available_addons: [] });
  });

  app.get<RefParams>('/platform/projects/:ref/compute-credits/hours', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ hours: [] });
  });

  // ── Org billing balance ───────────────────────────────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/billing/balance', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ balance: 0, currency: 'usd' });
  });

  // ── Org opt-in features (feature flags) ──────────────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/opt-in-features', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<SlugParams>('/platform/organizations/:slug/opt-in-features', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // ── Org OAuth apps (cloud-only GitHub/Vercel app connections) ────────────
  app.get<SlugParams>('/platform/organizations/:slug/oauth-apps', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Edge functions list (Studio Edge Functions page) ─────────────────────
  // The real edge-functions proxy goes through Kong (/functions/v1/*).
  // This endpoint returns the list metadata stored per-project.
  app.get<RefParams>('/platform/projects/:ref/functions', async (req, reply) => {
    app.requireAuth(req);
    try {
      const resp = await app.inject({
        method: 'GET',
        url: `/v1/projects/${req.params.ref}/functions`,
        headers: req.headers as Record<string, string>,
      });
      if (resp.statusCode === 200) return reply.status(200).send(resp.json<unknown>());
    } catch {
      // fall through
    }
    return reply.send([]);
  });

  // Edge function secrets — delegate to vault-backed /v1 secrets (T015)
  app.get<RefParams>('/platform/projects/:ref/functions/secrets', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/secrets`, headers: fwdHeaders(req) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.post<RefParams>('/platform/projects/:ref/functions/secrets', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'POST', url: `/v1/projects/${req.params.ref}/secrets`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.delete<RefParams>('/platform/projects/:ref/functions/secrets', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'DELETE', url: `/v1/projects/${req.params.ref}/secrets`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // ── Branching (not supported in self-hosted) ──────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/branches', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<RefParams>('/platform/projects/:ref/db-branches', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<RefParams>('/platform/projects/:ref/branches/rollback', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ eligible: false });
  });

  // ── Connection pooling config ─────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/connection-pooling', async (req, reply) => {
    app.requireAuth(req);
    const apex = process.env.SUPASTACK_APEX ?? 'localhost';
    return reply.send({
      pgbouncer_enabled: true,
      default_pool_size: 15,
      pool_mode: 'transaction',
      ignore_startup_parameters: 'extra_float_digits',
      db_host: `pooler.${apex}`,
      db_port: 6543,
    });
  });

  // ── Network bans — delegate to /v1 (T012) ────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/network-bans', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/network-bans`, headers: fwdHeaders(req) });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.delete<RefParams>('/platform/projects/:ref/network-bans', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({ method: 'DELETE', url: `/v1/projects/${req.params.ref}/network-bans`, headers: fwdHeaders(req) });
    return reply.status(resp.statusCode).send(resp.statusCode === 204 ? undefined : resp.json<unknown>());
  });

  // ── Edge config (cloud-only feature) ─────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/edge-config', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ edge_config: null });
  });

  // ── Upgrade eligibility ───────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/upgrade-eligibility', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ eligible: false, reasons: ['Self-hosted instance'] });
  });

  app.get<RefParams>('/platform/projects/:ref/upgrade/status', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    return reply.send({ status: inst.status === 'restoring' ? 'upgrading' : 'not_upgrading' });
  });

  // ── Project subscription (project-scoped billing) ────────────────────────
  app.get<RefParams>('/platform/projects/:ref/subscription', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({
      plan: { id: 'free', name: 'Free' },
      billing_via_partner: false,
      addons: [],
    });
  });

  // ── Project access management ─────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/manage-access', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ access_level: 'admin' });
  });

  // ── Replication (project-scoped path — Studio also uses /platform/replication/:ref/*) ──
  app.get<RefParams>('/platform/projects/:ref/replication/sources', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<RefParams>('/platform/projects/:ref/replication/destinations', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<RefParams>('/platform/projects/:ref/replication/pipelines', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Org member permissions ────────────────────────────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/members/permissions', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ can_manage_billing: true, can_invite_members: true });
  });

  // ── Org slug validation ───────────────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/platform/organizations/:slug/slugs/exists', async (req, reply) => {
    app.requireAuth(req);
    const exists = (await db()
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, req.params.slug))
      .limit(1)).length > 0;
    return reply.send({ exists });
  });

  // ── Profile MFA / security / notifications ────────────────────────────────
  app.get('/platform/profile/mfa', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ totp_enabled: false, factors: [] });
  });

  app.get('/platform/profile/security', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ mfa_enabled: false });
  });

  app.get('/platform/profile/notifications/preferences', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ email: true, in_app: true });
  });

  app.patch('/platform/profile/notifications/preferences', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // ── Analytics usage (Studio Dashboard stats) ─────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/analytics/usage', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ data: [], status: 200 });
  });

  // ── SQL credentials ───────────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/sql-credentials', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.post<RefParams>('/platform/projects/:ref/sql-credentials', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(201).send({ id: 'stub', ...((req.body as Record<string, unknown>) ?? {}) });
  });

  // ── Database supautils ────────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/database/supautils', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ enabled: true, version: null });
  });

  // ── Runs remaining (AI features — cloud-only) ─────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/runs-remaining', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ count: 0, limit: 0, used: 0 });
  });

  // ── Database hooks (pg-net hooks — proxy to pg-meta triggers path) ────────
  app.get<RefParams>('/platform/projects/:ref/database/hooks', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/platform/pg-meta/${req.params.ref}/triggers`,
      headers: req.headers as Record<string, string>,
    });
    if (resp.statusCode === 200) {
      const all = resp.json<Array<{ id: number; name: string; schema: string; table: string; function_args?: string[] }>>() ?? [];
      return reply.send(all.filter((t) => t.function_args && t.function_args.length > 0));
    }
    return reply.send([]);
  });

  // ── Database cron jobs (pg_cron — returns empty if not installed) ─────────
  app.get<RefParams>('/platform/projects/:ref/database/cron-jobs', async (req, reply) => {
    app.requireAuth(req);
    try {
      const rows = await withPerInstancePg(req.params.ref, async (pg) => {
        const res = await pg.query<{ jobid: number; schedule: string; command: string; nodename: string; nodeport: number; database: string; username: string; active: boolean; jobname: string | null }>(
          `SELECT jobid, schedule, command, nodename, nodeport, database, username, active, jobname FROM cron.job ORDER BY jobid`
        );
        return res.rows;
      });
      return reply.send(rows);
    } catch {
      return reply.send([]);
    }
  });

  app.get<RefParams>('/platform/projects/:ref/database/crons', async (req, reply) => {
    app.requireAuth(req);
    try {
      const rows = await withPerInstancePg(req.params.ref, async (pg) => {
        const res = await pg.query<{ jobid: number; schedule: string; command: string; active: boolean; jobname: string | null }>(
          `SELECT jobid, schedule, command, active, jobname FROM cron.job ORDER BY jobid`
        );
        return res.rows;
      });
      return reply.send(rows);
    } catch {
      return reply.send([]);
    }
  });

  // ── Database lint / advisors ──────────────────────────────────────────────
  // pg-meta doesn't expose a lint endpoint; return empty list so Studio renders OK.
  app.get<RefParams>('/platform/projects/:ref/database/lint', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<RefParams>('/platform/projects/:ref/advisors/performance', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ suggestions: [] });
  });

  app.get<RefParams>('/platform/projects/:ref/advisors/security', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ suggestions: [] });
  });

  app.get<RefParams>('/platform/projects/:ref/database/advisors', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ suggestions: [] });
  });

  // ── Column privileges (proxy to pg-meta) ─────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/database/column-privileges', async (req, reply) => {
    app.requireAuth(req);
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const resp = await app.inject({
      method: 'GET',
      url: `/platform/pg-meta/${req.params.ref}/column-privileges${qs ? '?' + qs : ''}`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.post<RefParams>('/platform/projects/:ref/database/column-privileges', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/platform/pg-meta/${req.params.ref}/column-privileges`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // ── Database query (proxy to /v1 query endpoint) ──────────────────────────
  app.post<RefParams>('/platform/projects/:ref/database/query', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/v1/projects/${req.params.ref}/database/query`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // ── Project volumes (not supported in self-hosted) ────────────────────────
  app.get<RefParams>('/platform/projects/:ref/volumes', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Project audit log — real events from audit_log (T007) ────────────────
  app.get<RefParams & { Querystring: { rows?: string; page?: string } }>('/platform/projects/:ref/audit', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const limit = Math.min(parseInt((req.query as Record<string, string>).rows ?? '50', 10) || 50, 200);
    const page = Math.max(parseInt((req.query as Record<string, string>).page ?? '1', 10) || 1, 1);
    const offset = (page - 1) * limit;
    const rows = await db()
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        actorUserId: schema.auditLog.actorUserId,
        actorEmail: schema.users.email,
        targetKind: schema.auditLog.targetKind,
        targetId: schema.auditLog.targetId,
        payload: schema.auditLog.payload,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorUserId))
      .where(eq(schema.auditLog.targetId, req.params.ref))
      .orderBy(desc(schema.auditLog.id))
      .limit(limit)
      .offset(offset);
    const [countRow] = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, req.params.ref));
    return reply.send({
      result: rows.map((r) => ({
        id: String(r.id),
        action: r.action,
        actor_id: r.actorUserId,
        actor_email: r.actorEmail,
        target_kind: r.targetKind,
        target_id: r.targetId,
        metadata: r.payload,
        created_at: r.createdAt.toISOString(),
      })),
      count: countRow?.count ?? 0,
    });
  });

  // ── Project activity — chronological audit events (T008) ─────────────────
  app.get<RefParams>('/platform/projects/:ref/activity', async (req, reply) => {
    const user = app.requireAuth(req);
    const [inst] = await db()
      .select({ ref: schema.supabaseInstances.ref })
      .from(schema.supabaseInstances)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
      .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });
    const rows = await db()
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        actorUserId: schema.auditLog.actorUserId,
        actorEmail: schema.users.email,
        targetKind: schema.auditLog.targetKind,
        targetId: schema.auditLog.targetId,
        payload: schema.auditLog.payload,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorUserId))
      .where(eq(schema.auditLog.targetId, req.params.ref))
      .orderBy(asc(schema.auditLog.id));
    return reply.send(
      rows.map((r) => ({
        id: String(r.id),
        action: r.action,
        actor_id: r.actorUserId,
        actor_email: r.actorEmail,
        target_kind: r.targetKind,
        target_id: r.targetId,
        metadata: r.payload,
        created_at: r.createdAt.toISOString(),
      })),
    );
  });

  // ── Replication connections ───────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/replication/connections', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Realtime subscriptions ────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/subscriptions', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Firewall rules ────────────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/firewall', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ enabled: false, rules: [] });
  });

  app.post<RefParams>('/platform/projects/:ref/firewall', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Firewall not supported on self-hosted' });
  });

  // ── GitHub / Vercel integrations (cloud-only) ─────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/vercel', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  app.get<RefParams>('/platform/projects/:ref/github', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Content snapshots ────────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/content/snapshots', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Analytics reports ────────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/analytics/reports', async (req, reply) => {
    app.requireAuth(req);
    return reply.send([]);
  });

  // ── Profile two-factor authentication ────────────────────────────────────
  app.get('/platform/profile/two-factor-authentication', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ enabled: false, totp: null, phone: null });
  });

  // ── Org project transfer ──────────────────────────────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/projects/transfer', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ eligible: false, reasons: ['Transfer not supported on self-hosted'] });
  });

  // ── GraphQL schema ────────────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/api/graphql/schema', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ schema: null });
  });

  // ── Analytics overview ────────────────────────────────────────────────────
  app.get<RefParams>('/platform/projects/:ref/analytics/overview', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ data: [], status: 200 });
  });

  // ── Org project-transfer eligibility ─────────────────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/project-transfer-eligibility', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ eligible: false });
  });

  // ── Database report (summary stats for Studio's Database Report page) ─────
  app.get<RefParams>('/platform/projects/:ref/database/report', async (req, reply) => {
    app.requireAuth(req);
    try {
      const rows = await withPerInstancePg(req.params.ref, async (pg) => {
        const res = await pg.query<{ schemaname: string; tablename: string; n_live_tup: string; n_dead_tup: string; pg_total_relation_size: string }>(
          `SELECT schemaname, tablename, n_live_tup, n_dead_tup,
            pg_total_relation_size(quote_ident(schemaname)||'.'||quote_ident(tablename)) AS pg_total_relation_size
           FROM pg_stat_user_tables ORDER BY pg_total_relation_size DESC LIMIT 50`
        );
        return res.rows;
      });
      return reply.send({
        result: rows.map((r) => ({
          schema: r.schemaname,
          name: r.tablename,
          live_rows_estimate: Number(r.n_live_tup),
          dead_rows_estimate: Number(r.n_dead_tup),
          total_size: Number(r.pg_total_relation_size),
        })),
      });
    } catch {
      return reply.send({ result: [] });
    }
  });

  // ── Profile preferences ───────────────────────────────────────────────────
  app.get('/platform/profile/preferences', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ theme: 'dark', locale: 'en' });
  });

  app.put('/platform/profile/preferences', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // ── Platform feature flags ────────────────────────────────────────────────
  app.get('/platform/flags', async (req, reply) => {
    return reply.send({});
  });

  // ── Vercel integration (cloud-only) ──────────────────────────────────────
  app.get('/platform/vercel/oauth/token', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ token: null });
  });

  app.get('/platform/integrations/vercel/authorize', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ url: null });
  });

  // ── Project secrets (vault-backed secrets surface at /platform level) ─────
  // Studio calls /platform/projects/:ref/secrets (different from /config/secrets).
  // Delegate to the vault-backed /v1/projects/:ref/secrets.
  app.get<RefParams>('/platform/projects/:ref/secrets', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/secrets`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.post<RefParams>('/platform/projects/:ref/secrets', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'POST',
      url: `/v1/projects/${req.params.ref}/secrets`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.delete<{ Params: { ref: string; id: string } }>('/platform/projects/:ref/secrets/:id', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${req.params.ref}/secrets/${req.params.id}`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>() ?? {});
  });

  // ── Project deployment info (not applicable to self-hosted) ──────────────
  app.get<RefParams>('/platform/projects/:ref/deployment', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ id: null, status: 'idle' });
  });

  // ── Project config shortcuts (alias to /v1 config routes) ────────────────
  // Studio may call /platform/projects/:ref/config/auth alongside /platform/auth/:ref/config
  app.get<RefParams>('/platform/projects/:ref/config/auth', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/platform/auth/${req.params.ref}/config`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.patch<RefParams>('/platform/projects/:ref/config/auth', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/platform/auth/${req.params.ref}/config`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  // AI config (cloud feature — return empty)
  app.get<RefParams>('/platform/projects/:ref/config/ai', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ enabled: false });
  });

  app.patch<RefParams>('/platform/projects/:ref/config/ai', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // Email/SMS config aliases (Studio calls these on the Auth > SMTP page)
  app.get<RefParams>('/platform/projects/:ref/config/email', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/platform/auth/${req.params.ref}/config`,
      headers: req.headers as Record<string, string>,
    });
    if (resp.statusCode === 200) {
      const c = resp.json<Record<string, unknown>>();
      return reply.send({ smtp_host: c.smtp_host, smtp_port: c.smtp_port, smtp_user: c.smtp_user, smtp_pass: c.smtp_pass, smtp_sender_name: c.smtp_sender_name, smtp_admin_email: c.smtp_admin_email, smtp_max_frequency: c.smtp_max_frequency, mailer_secure_email_change_enabled: c.mailer_secure_email_change_enabled });
    }
    return reply.send({});
  });

  app.patch<RefParams>('/platform/projects/:ref/config/email', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/platform/auth/${req.params.ref}/config`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.get<RefParams>('/platform/projects/:ref/config/sms', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ sms_provider: null, sms_twilio_account_sid: null, sms_twilio_auth_token: null, sms_twilio_message_service_sid: null });
  });

  app.patch<RefParams>('/platform/projects/:ref/config/sms', async (req, reply) => {
    app.requireAuth(req);
    return reply.send(req.body ?? {});
  });

  // ── PITR / point-in-time recovery (not supported in self-hosted) ──────────
  app.get<RefParams>('/platform/database/:ref/point-in-time-recovery', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ enabled: false });
  });

  app.get<RefParams>('/platform/database/:ref/pitr/status', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ status: 'not_configured' });
  });

  // ── Profile organizations (list orgs the user belongs to) ────────────────
  app.get('/platform/profile/organizations', async (req, reply) => {
    const user = app.requireAuth(req);
    const rows = await db()
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        slug: schema.organizations.id,
        role: schema.organizationMembers.role,
        createdAt: schema.organizations.createdAt,
      })
      .from(schema.organizations)
      .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, user.id));
    return reply.send(rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.id,
      role: r.role,
      created_at: r.createdAt?.toISOString() ?? new Date().toISOString(),
    })));
  });

  // ── Org slug update / transfer ────────────────────────────────────────────
  app.get<SlugParams>('/platform/organizations/:slug/slug', async (req, reply) => {
    await app.authorizeOrg(req, 'org.read', req.params.slug);
    return reply.send({ slug: req.params.slug });
  });

  app.put<SlugParams>('/platform/organizations/:slug/slug', async (req, reply) => {
    await app.authorizeOrg(req, 'org.update', req.params.slug);
    return reply.status(400).send({ error: 'Slug changes are not supported on self-hosted' });
  });

  app.post<SlugParams>('/platform/organizations/:slug/transfer', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ error: 'Organization transfer not supported on self-hosted' });
  });

  // ── Single edge function (GET/PATCH/DELETE by slug) ──────────────────────
  app.get<{ Params: { ref: string; slug: string } }>('/platform/projects/:ref/functions/:slug', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'GET',
      url: `/v1/projects/${req.params.ref}/functions/${req.params.slug}`,
      headers: req.headers as Record<string, string>,
    });
    if (resp.statusCode === 200) return reply.send(resp.json<unknown>());
    return reply.status(404).send({ error: 'Function not found' });
  });

  app.patch<{ Params: { ref: string; slug: string } }>('/platform/projects/:ref/functions/:slug', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${req.params.ref}/functions/${req.params.slug}`,
      headers: req.headers as Record<string, string>,
      payload: JSON.stringify(req.body),
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>());
  });

  app.delete<{ Params: { ref: string; slug: string } }>('/platform/projects/:ref/functions/:slug', async (req, reply) => {
    app.requireAuth(req);
    const resp = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${req.params.ref}/functions/${req.params.slug}`,
      headers: req.headers as Record<string, string>,
    });
    return reply.status(resp.statusCode).send(resp.json<unknown>() ?? {});
  });

  // ── Database resource proxies → pg-meta (CRUD for tables, views, functions, etc.) ──
  // Studio's "Database" section calls /platform/projects/:ref/database/<resource>
  // which are NOT served by the /platform/pg-meta/:ref/* wildcard because the path prefix differs.
  // These proxy to the pg-meta service so Studio's schema editor / policy editor / etc. work.
  const DB_PGMETA_RESOURCES = [
    'roles', 'schemas', 'tables', 'views', 'functions', 'triggers',
    'indexes', 'policies', 'publications', 'foreign-tables',
    'materialized-views', 'sequences', 'types',
  ] as const;

  function pgMetaProxy(ref: string, pgMetaPath: string, method: string, headers: Record<string, string>, body?: unknown) {
    return app.inject({
      method: method as 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
      url: `/platform/pg-meta/${ref}/${pgMetaPath}`,
      headers,
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  for (const resource of DB_PGMETA_RESOURCES) {
    app.get<RefParams>(`/platform/projects/:ref/database/${resource}`, async (req, reply) => {
      app.requireAuth(req);
      const qs = new URLSearchParams(req.query as Record<string, string>).toString();
      const resp = await pgMetaProxy(req.params.ref, `${resource}${qs ? '?' + qs : ''}`, 'GET', req.headers as Record<string, string>);
      return reply.status(resp.statusCode).send(resp.json<unknown>());
    });

    app.post<RefParams>(`/platform/projects/:ref/database/${resource}`, async (req, reply) => {
      app.requireAuth(req);
      const resp = await pgMetaProxy(req.params.ref, resource, 'POST', req.headers as Record<string, string>, req.body);
      return reply.status(resp.statusCode).send(resp.json<unknown>());
    });

    app.patch<{ Params: { ref: string; id: string } }>(`/platform/projects/:ref/database/${resource}/:id`, async (req, reply) => {
      app.requireAuth(req);
      const resp = await pgMetaProxy(req.params.ref, `${resource}/${req.params.id}`, 'PATCH', req.headers as Record<string, string>, req.body);
      return reply.status(resp.statusCode).send(resp.json<unknown>());
    });

    app.delete<{ Params: { ref: string; id: string } }>(`/platform/projects/:ref/database/${resource}/:id`, async (req, reply) => {
      app.requireAuth(req);
      const qs = new URLSearchParams(req.query as Record<string, string>).toString();
      const resp = await pgMetaProxy(req.params.ref, `${resource}/${req.params.id}${qs ? '?' + qs : ''}`, 'DELETE', req.headers as Record<string, string>);
      return reply.status(resp.statusCode).send(resp.json<unknown>());
    });
  }

  // ── SSO write stubs (cloud-only; self-hosted SAML out of scope) ─────────────
  app.post<SlugParams>('/platform/organizations/:slug/sso', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ message: 'SSO is not supported on self-hosted' });
  });

  app.delete<SlugParams>('/platform/organizations/:slug/sso', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ message: 'SSO is not supported on self-hosted' });
  });

  app.put<SlugParams>('/platform/organizations/:slug/sso', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ message: 'SSO is not supported on self-hosted' });
  });

  // ── Plans & features (cloud-only billing; self-hosted returns static free plan) ─
  app.get('/platform/plans/features', async (_req, reply) => {
    return reply.send({
      features: [
        { id: 'database', name: 'Database', included: true },
        { id: 'auth', name: 'Authentication', included: true },
        { id: 'storage', name: 'Storage', included: true },
        { id: 'edge_functions', name: 'Edge Functions', included: true },
        { id: 'realtime', name: 'Realtime', included: true },
      ],
    });
  });

  // ── GitHub integration extras ─────────────────────────────────────────────
  app.get<{ Params: { repository_id: string } }>(
    '/platform/integrations/github/repositories/:repository_id/branches',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send([]);
    },
  );

  app.get<{ Params: { repository_id: string; branch_name: string } }>(
    '/platform/integrations/github/repositories/:repository_id/branches/:branch_name',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(404).send({ message: 'Branch not found' });
    },
  );

  // ── Vercel integration endpoints (cloud-only; stubs for self-hosted) ──────
  app.post('/platform/integrations/vercel', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ message: 'Vercel integration not supported on self-hosted' });
  });

  app.post('/platform/integrations/vercel/connections', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ message: 'Vercel integration not supported on self-hosted' });
  });

  app.get<{ Params: { ref: string } }>(
    '/platform/integrations/vercel/connections/project/:ref',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send([]);
    },
  );

  app.delete<{ Params: { connection_id: string } }>(
    '/platform/integrations/vercel/connections/:connection_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(400).send({ message: 'Vercel integration not supported on self-hosted' });
    },
  );

  app.patch<{ Params: { connection_id: string } }>(
    '/platform/integrations/vercel/connections/:connection_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(400).send({ message: 'Vercel integration not supported on self-hosted' });
    },
  );

  app.post<{ Params: { connection_id: string } }>(
    '/platform/integrations/vercel/connections/:connection_id/sync-envs',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(400).send({ message: 'Vercel integration not supported on self-hosted' });
    },
  );

  app.get<{ Params: { organization_integration_id: string } }>(
    '/platform/integrations/vercel/projects/:organization_integration_id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.send([]);
    },
  );

  // ── PrivateLink (cloud VPC networking — not applicable self-hosted) ────────
  app.get<{ Params: { slug: string } }>('/platform/integrations/private-link/:slug', async (req, reply) => {
    app.requireAuth(req);
    return reply.send({ enabled: false, endpoints: [] });
  });

  app.put<{ Params: { slug: string } }>('/platform/integrations/private-link/:slug', async (req, reply) => {
    app.requireAuth(req);
    return reply.status(400).send({ message: 'PrivateLink not supported on self-hosted' });
  });

  // ── Partners integration (marketplace — not applicable self-hosted) ────────
  app.post<{ Params: { ref: string; listing_slug: string } }>(
    '/platform/integrations/partners/:ref/:listing_slug',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(400).send({ message: 'Partner integrations not supported on self-hosted' });
    },
  );

  // ── Stripe provisioning (billing-only endpoints) ──────────────────────────
  app.get<{ Params: { id: string } }>(
    '/platform/stripe/projects/provisioning/account_requests/:id',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(404).send({ message: 'Not found' });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/platform/stripe/projects/provisioning/account_requests/:id/confirm',
    async (req, reply) => {
      app.requireAuth(req);
      return reply.status(400).send({ message: 'Billing not supported on self-hosted' });
    },
  );
};

function toAccessToken(r: {
  id: string;
  name: string;
  tokenAlias: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}) {
  return {
    id: r.id,
    name: r.name,
    token_alias: r.tokenAlias ?? '',
    scope: 'V0' as const,
    created_at: r.createdAt.toISOString(),
    expires_at: null,
    last_used_at: r.lastUsedAt?.toISOString() ?? null,
  };
}

/**
 * Map the internal `supabaseInstances.status` to the Studio PROJECT_STATUS enum
 * (`lib/constants/infrastructure.ts`: ACTIVE_HEALTHY/RESTORING/PAUSING/COMING_UP/…).
 * Single source — used by /status, /databases-statuses, buildProject, and the
 * project list so the project badge, the database list, and the restore poll
 * never disagree (#106). `running → ACTIVE_HEALTHY`, everything else upper-cased
 * (`restoring → RESTORING`, `paused → PAUSED`, …).
 */
export function toStudioProjectStatus(status: string): string {
  return status === 'running' ? 'ACTIVE_HEALTHY' : status.toUpperCase();
}

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
    organization_slug: inst.orgId,
    parent_project_ref: null,
    preview_branch_refs: [],
    ref: inst.ref,
    region: 'local',
    restUrl: `${kongUrl}/rest/v1`,
    status: toStudioProjectStatus(inst.status),
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
        status: toStudioProjectStatus(inst.status),
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
    plan: { id: 'pro', name: 'Pro' },
    restriction_data: null,
    restriction_status: null,
    stripe_customer_id: null,
    subscription_id: null,
    usage_billing_enabled: false,
  };
}
