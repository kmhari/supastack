import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { corsOptions } from './config/cors-config.js';
import multipart from '@fastify/multipart';
import { loadMasterKey } from '@supastack/crypto';
import { makeDb, migrate } from '@supastack/db';
import { AppError, errors, getApex } from '@supastack/shared';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { authPlugin } from './plugins/auth.js';
import { mgmtApiErrorsPlugin } from './plugins/mgmt-api-errors.js';
import { rbacPlugin } from './plugins/rbac.js';
import { acmeChallengeRoutes } from './routes/acme-challenge.js';
import { apexRoutes } from './routes/apex.js';
import { auditRoutes } from './routes/audit.js';
import { authRoutes } from './routes/auth.js';
import { backupsRoutes } from './routes/backups.js';
import { caddyInternalRoutes } from './routes/caddy-internal.js';
import { instanceInternalRoutes } from './routes/instance-internal.js';
import { cliLoginRoutes } from './routes/cli-login.js';
import { connectCliRoutes } from './routes/connect-cli.js';
import { healthRoutes } from './routes/health.js';
import { probeProjectHealth, DEFAULT_HEALTH_SERVICES } from './services/project-health-service.js';
import { getProjectServices } from './services/service-versions-service.js';
import { instancesRoutes } from './routes/instances.js';
import { adminRoutes } from './routes/admin.js';
import { apiKeysRoutes } from './routes/management/api-keys.js';
import { authConfigRoutes } from './routes/management/auth-config.js';
import { backupsMgmtRoutes } from './routes/management/backups-mgmt.js';
import { billingAddonsRoutes } from './routes/management/billing-addons.js';
import { cliLoginRoleRoutes } from './routes/management/cli-login-role.js';
import { dbDumpRoutes } from './routes/management/db-dump.js';
import { dbQueryRoutes } from './routes/management/db-query.js';
import { functionsRoutes } from './routes/management/functions.js';
import { genTypesRoutes } from './routes/management/gen-types.js';
import { logsRoutes } from './routes/management/logs.js';
import { migrationsRoutes } from './routes/management/migrations.js';
import { notImplementedRoutes } from './routes/management/not-implemented.js';
import { organizationsRoutes } from './routes/management/organizations.js';
import { pauseRestoreRoutes } from './routes/management/pause-restore.js';
import { pgbouncerConfigRoutes } from './routes/management/pgbouncer-config.js';
import { postgresConfigRoutes } from './routes/management/postgres-config.js';
import { postgrestConfigRoutes } from './routes/management/postgrest-config.js';
import { realtimeConfigRoutes } from './routes/management/realtime-config.js';
import { profileRoutes } from './routes/management/profile.js';
import { projectsRoutes } from './routes/management/projects.js';
import { secretsRoutes } from './routes/management/secrets.js';
import { sslEnforcementRoutes } from './routes/management/ssl-enforcement.js';
import { storageBucketsRoutes } from './routes/management/storage-buckets.js';
import { oauthAuthorizeRoutes } from './routes/oauth/authorize.js';
import { oauthClientsDashboardRoutes } from './routes/oauth/clients-dashboard.js';
import { oauthDiscoveryRoutes } from './routes/oauth/discovery.js';
import { oauthRegisterRoutes } from './routes/oauth/register.js';
import { oauthTokenRoutes } from './routes/oauth/token.js';
import { orgRoutes } from './routes/org.js';
import { pgEdgeCertInternalRoutes } from './routes/pg-edge-cert-internal.js';
import { platformCliLoginRoutes } from './routes/platform-cli-login.js';
import { platformProxyRoutes } from './routes/platform-proxy.js';
import { platformMiscRoutes } from './routes/platform-misc.js';
import { poolerInternalRoutes } from './routes/pooler-internal.js';
import { poolerReconcilerRunRoutes } from './routes/pooler-reconciler-run.js';
import { poolerReregisterRoutes } from './routes/pooler-reregister.js';
import { poolerStatusRoutes } from './routes/pooler-status.js';
import { resetPgPasswordRoutes } from './routes/reset-pg-password.js';
import { secretsDashboardRoutes } from './routes/secrets-dashboard.js';
import { setupRoutes } from './routes/setup.js';
import { tlsAskRoutes } from './routes/tls-ask.js';
import { vaultEnableRoutes } from './routes/vault-enable.js';
import { wildcardCertRoutes } from './routes/wildcard-certs.js';
import { createCertCheckQueue, createCertCheckWorker } from './services/cert-check.js';
import { startPgEdgeProxy, type PgEdgeProxy } from './services/pg-edge-proxy.js';
import { ensurePlaceholderCertAtBoot } from './services/placeholder-cert.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const REDIS_URL = process.env.REDIS_URL ?? '';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

/**
 * Pre-startup guard. Refuse to boot if any critical secret is missing or
 * malformed. Honors FR-012 and SC-011: never silently fall back to plaintext.
 */
function preflightGuards(): void {
  if (!DATABASE_URL) throw errors.invalidInput('DATABASE_URL env is missing');
  if (!REDIS_URL) throw errors.invalidInput('REDIS_URL env is missing');
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw errors.invalidInput('SESSION_SECRET env must be at least 32 chars');
  }
  // loadMasterKey() throws if MASTER_KEY missing/malformed
  try {
    loadMasterKey();
  } catch {
    throw errors.masterKeyMissing();
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  preflightGuards();

  // Feature 021 T005 — install a fake docker control when the test mode env
  // var is set. This lets the browser-test harness (and any other consumer)
  // create projects via POST /api/v1/instances without actually spinning up
  // per-instance container stacks. Production builds (env unset) skip this
  // hook entirely; the real dockerode-backed control is used as before.
  if (process.env.SUPASTACK_TEST_FAKE_DOCKER === '1') {
    (globalThis as { __supastackFakeDockerControl?: unknown }).__supastackFakeDockerControl = {
      restart: async (_name: string): Promise<void> => {},
      waitHealthy: async (_name: string, _timeoutMs?: number): Promise<void> => {},
    };
  }

  // DB
  makeDb(DATABASE_URL);
  await migrate(DATABASE_URL);

  // First-boot placeholder wildcard cert (fresh-install fix): supavisor
  // hard-fails on a missing GLOBAL_DOWNSTREAM_CERT_PATH file, and the real
  // cert only exists after /setup. Non-fatal, no-op when certs exist.
  await ensurePlaceholderCertAtBoot();

  // Use Fastify's own pino with LoggerOptions — avoids the v4 instance-type
  // mismatch between our shared logger's full pino.Logger and Fastify's
  // FastifyBaseLogger interface. Our @supastack/shared logger remains the
  // primary structured logger for non-request paths (worker, services).
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
    // 50 MB ceiling for the eszip + multipart deploy paths (raw eszip bodies
    // and multipart uploads under /v1/projects/:ref/functions). Dashboard
    // routes only deal in JSON payloads; the larger cap is harmless for them.
    bodyLimit: 50 * 1024 * 1024,
    disableRequestLogging: false,
  });

  // Raw-body parser for the CLI's eszip deploy path. The CLI sends
  // `Content-Type: application/vnd.denoland.eszip`; without this Fastify
  // would leave req.body as undefined. Also accept octet-stream as the
  // belt-and-braces fallback (some CLI versions emit it).
  app.addContentTypeParser(
    'application/vnd.denoland.eszip',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  );

  // Feature 014 — OAuth 2.1 endpoints (authorize consent submit + RFC 6749
  // token endpoint) accept application/x-www-form-urlencoded per RFC. Parse
  // into an object so route handlers + Zod can consume it uniformly with
  // JSON bodies.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const params = new URLSearchParams(body as string);
        const obj: Record<string, string> = {};
        for (const [k, v] of params) obj[k] = v;
        done(null, obj);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Uniform error formatter. Dashboard surface (everything except /v1) uses
  // supastack's envelope `{error: {code, message}}`; the CLI compat surface
  // (`/v1/*`) needs the cloud envelope `{message, code, details?}` so the
  // upstream Supabase CLI's generated Go client can parse it.
  //
  // The /v1 scope's own setErrorHandler (mgmt-api-errors plugin) only catches
  // errors thrown from routes/preValidation/preHandlers REGISTERED inside
  // that scope. The global auth plugin uses fastify-plugin (fp) which
  // escapes encapsulation; its preHandler throws AppError at the global
  // level, landing here. URL-sniff so cloud consumers see the right shape.
  app.setErrorHandler((err, req, reply) => {
    const isMgmt = req.url.startsWith('/v1/') || req.url === '/v1';
    if (err instanceof AppError) {
      if (isMgmt) {
        reply.status(err.statusCode).send({
          message: err.message,
          code: err.code,
          ...(err.details ? { details: err.details } : {}),
        });
        return;
      }
      reply.status(err.statusCode).send(err.toBody());
      return;
    }
    if ((err as { validation?: unknown }).validation) {
      if (isMgmt) {
        reply.status(400).send({ message: err.message, code: 'bad_request' });
        return;
      }
      reply.status(400).send(errors.invalidInput(err.message).toBody());
      return;
    }
    req.log.error({ err }, 'unhandled error');
    if (isMgmt) {
      reply.status(500).send({ message: 'Internal server error', code: 'internal' });
      return;
    }
    reply.status(500).send(errors.internal().toBody());
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  // Feature 107 — scoped CORS (single source) for the cross-origin dashboard at
  // api.<apex>; exact apex origin only (never *), Bearer auth → no credentials.
  await app.register(cors, corsOptions());
  await app.register(authPlugin);
  await app.register(rbacPlugin);

  // Routes — public under /api/v1, internal endpoints at root
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(setupRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(orgRoutes, { prefix: '/api/v1' });
  await app.register(apexRoutes, { prefix: '/api/v1' });
  await app.register(instancesRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1' }); // feature 116 — /api/v1/admin/*
  await app.register(backupsRoutes, { prefix: '/api/v1' });
  await app.register(auditRoutes, { prefix: '/api/v1' });
  await app.register(connectCliRoutes, { prefix: '/api/v1' });
  await app.register(wildcardCertRoutes, { prefix: '/api/v1' });
  await app.register(tlsAskRoutes); // /internal/tls/ask
  await app.register(caddyInternalRoutes); // /internal/caddy/reload
  await app.register(acmeChallengeRoutes); // /.well-known/acme-challenge/:token (HTTP-01)
  await app.register(pgEdgeCertInternalRoutes); // /internal/pg-edge-cert/issue
  await app.register(poolerInternalRoutes); // /internal/pooler/tenants
  await app.register(instanceInternalRoutes); // /internal/instances/:ref/adopt-platform-jwt
  await app.register(poolerReconcilerRunRoutes); // /api/v1/pooler/reconciler/run (feature 008 US1)
  await app.register(resetPgPasswordRoutes); // /api/v1/instances/:ref/reset-pg-password (feature 008 US3)
  await app.register(poolerStatusRoutes); // /api/v1/pooler/status (feature 008 US2)
  await app.register(poolerReregisterRoutes); // /api/v1/pooler/tenants/:ref/re-register (feature 008 US2)
  await app.register(vaultEnableRoutes); // /api/v1/projects/:ref/vault/enable (feature 010 FR-002)
  await app.register(secretsDashboardRoutes); // /api/v1/projects/:ref/secrets (feature 010 FR-006/007)
  await app.register(cliLoginRoutes); // /api/v1/cli/login (feature 011 — dashboard mint)
  await app.register(platformCliLoginRoutes); // /platform/cli/login/:session_id (feature 011 — CLI poll)
  await app.register(platformProxyRoutes); // /platform/* (direct Caddy /platform/* rule)
  // Feature 086 US1 — base=root cutover. Also mount platformMiscRoutes at root so
  // the base=root Studio's /platform/* calls resolve at the apex (the proxy was
  // already dual-mounted at root; misc was only at /api/v1). Disjoint paths from
  // platformProxyRoutes, so co-registering at root is safe.
  await app.register(platformMiscRoutes); // /platform/* misc at root (base=root, US1)
  // Feature 086 T012 — the `/api/v1`-prefixed platform mounts were removed after the
  // base=root cutover; the Studio reaches platform routes at the apex `/platform/*`.
  // Studio Next.js API routes that the Supastack API stubs at the root level
  app.get('/api/get-deployment-commit', async (_req, reply) =>
    reply.send({ commit: 'dev', date: new Date().toISOString() }),
  );
  app.get('/api/incident-banner', async (_req, reply) => reply.send(null));
  // Studio's incident-status route queries Supabase's StatusPage (api.statuspage.io)
  // and 500s when STATUSPAGE_* env is absent (self-hosted). The client expects an
  // array of active incidents — return none.
  app.get('/api/incident-status', async (_req, reply) => reply.send([]));

  // Studio's AI SQL title endpoint — generate a title/description from SQL structure
  // without an LLM (no OPENAI_API_KEY needed). Mirrors Cloud's response shape.
  app.post('/api/ai/sql/title-v2', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawSql = typeof body.sql === 'string' ? body.sql.trim() : '';
    return reply.send(parseSqlTitle(rawSql));
  });

  // Management API stubs for Studio IS_PLATFORM=true — registered before the
  // /v1 management plugin so they respond without the mgmt error envelope.
  type RefP = { Params: { ref: string } };
  app.get<RefP>('/v1/projects/:ref/network-bans', async (_req, reply) =>
    reply.send({ banned_ipv4_addresses: [] }),
  );
  app.post<RefP>('/v1/projects/:ref/network-bans/retrieve', async (_req, reply) =>
    reply.send({ banned_ipv4_addresses: [] }),
  );
  app.delete<RefP>('/v1/projects/:ref/network-bans', async (_req, reply) =>
    reply.status(204).send(),
  );
  app.get<RefP>('/v1/projects/:ref/network-restrictions', async (_req, reply) =>
    reply.send({
      entitlement: 'disallowed',
      config: { dbAllowedCidrs: [], dbAllowedCidrsReadReplicas: [] },
    }),
  );
  app.post<RefP>('/v1/projects/:ref/network-restrictions/apply', async (req, reply) =>
    reply.send(req.body ?? {}),
  );
  app.get<RefP>('/v1/projects/:ref/custom-hostname', async (_req, reply) =>
    reply.send({ status: 'not_started', customHostname: null, data: {} }),
  );
  app.get<RefP>('/v1/projects/:ref/branches', async (_req, reply) => reply.send([]));
  app.get<RefP>('/v1/projects/:ref/read-replicas', async (_req, reply) => reply.send([]));
  app.get<RefP>('/v1/projects/:ref/upgrade/eligibility', async (_req, reply) =>
    reply.send({ eligible: false, current_app_version: 'supabase-postgres-15.0.0.55' }),
  );
  // /legacy is the older Studio path for the same anon+service_role keys
  // JIT DB access — Studio does `data.items` on this response
  app.get<RefP>('/v1/projects/:ref/database/jit/list', async (_req, reply) =>
    reply.send({ items: [] }),
  );

  app.get<RefP>('/v1/projects/:ref/config/auth/signing-keys/legacy', async (req, reply) => {
    const user = app.requireAuth(req);
    const { getProjectByRef } = await import('./services/project-store.js');
    const { decryptJson, loadMasterKey } = await import('@supastack/crypto');
    const row = await getProjectByRef(user.id, req.params.ref);
    if (!row) return reply.status(404).send({ error: 'Project not found' });
    const secrets = decryptJson(row.encryptedSecrets, loadMasterKey()) as { jwtSecret: string };
    return reply.send([{ algorithm: 'HS256', status: 'active', secret: secrets.jwtSecret }]);
  });

  app.get<RefP>('/v1/projects/:ref/api-keys/legacy', async (req, reply) => {
    const user = app.requireAuth(req);
    const { getProjectByRef } = await import('./services/project-store.js');
    const { decryptJson, loadMasterKey } = await import('@supastack/crypto');
    const { instanceApiKeys } = await import('./services/mgmt-api-mapping.js');
    const row = await getProjectByRef(user.id, req.params.ref);
    if (!row) return reply.status(404).send({ error: 'Project not found' });
    const secrets = decryptJson(row.encryptedSecrets, loadMasterKey());
    return reply.send(instanceApiKeys(secrets as Parameters<typeof instanceApiKeys>[0]));
  });

  // JWT signing keys — return the jwtSecret as the active HS256 signing key
  app.get<RefP>('/v1/projects/:ref/config/auth/signing-keys', async (req, reply) => {
    const user = app.requireAuth(req);
    const { getProjectByRef } = await import('./services/project-store.js');
    const { decryptJson, loadMasterKey } = await import('@supastack/crypto');
    const row = await getProjectByRef(user.id, req.params.ref);
    if (!row) return reply.status(404).send({ error: 'Project not found' });
    const secrets = decryptJson(row.encryptedSecrets, loadMasterKey()) as { jwtSecret: string };
    return reply.send({
      signing_keys: [{ algorithm: 'HS256', status: 'active', secret: secrets.jwtSecret }],
    });
  });
  app.get<RefP>('/v1/projects/:ref/upgrade/status', async (_req, reply) =>
    reply.send({ status: 'ready' }),
  );
  app.get<RefP & { Querystring: { services?: string } }>(
    '/v1/projects/:ref/health',
    async (req, reply) => {
      const services = req.query.services
        ? req.query.services
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [...DEFAULT_HEALTH_SERVICES];
      const result = await probeProjectHealth(req.params.ref, services);
      if (result.notFound) {
        return reply.status(404).send({ message: `Project ${req.params.ref} not found` });
      }
      return reply.send(result.services);
    },
  );

  // Service versions — reflect actual image tags from the per-instance compose template.
  // Per-service image versions, read from the project's own compose (real tags,
  // not hardcoded — the old stub drifted). status mirrors the instance state.
  app.get<RefP>('/v1/projects/:ref/services', async (req, reply) => {
    const result = await getProjectServices(req.params.ref);
    if (result.notFound) {
      return reply.status(404).send({ message: `Project ${req.params.ref} not found` });
    }
    return reply.send(result.services);
  });

  // Third-party auth providers — not supported in self-hosted
  app.get<RefP>('/v1/projects/:ref/config/auth/third-party-auth', async (_req, reply) =>
    reply.send([]),
  );

  // Feature 086 T012 — the `/api/v1/v1/*` double-v1 rewrite shim was removed after
  // the base=root cutover: the base=root Studio now calls `/v1/*` at the apex
  // directly (routed to the `/v1` mgmt mount by Caddy), so no rewrite is needed.
  await app.register(oauthDiscoveryRoutes); // /.well-known/oauth-authorization-server (feature 014 FR-006)
  await app.register(oauthClientsDashboardRoutes); // /api/v1/oauth/clients{,/:id} (feature 014 US3)
  // Feature 020 — dashboard mounts the auth-config route alongside the /v1 mgmt mount
  // so the SPA can talk to /api/v1/projects/:ref/config/auth (same-origin) without
  // having to cross to api.<apex>. Same handler; dashboard error envelope shape.
  await app.register(authConfigRoutes, { prefix: '/api/v1' });

  // ─── /v1/* — Supabase Management API compatibility surface ─────────────
  //
  // Spec: specs/003-supabase-cli-compat-p0/plan.md
  //
  // The mgmtApiErrorsPlugin replaces the global error formatter inside this
  // scope (Fastify encapsulation) so responses match the cloud's envelope
  // `{ message, code?, details? }` instead of supastack's dashboard shape.
  // Multipart is scoped here too so the existing dashboard routes don't
  // accidentally accept binary uploads. bodyLimit is bumped to 50 MB for
  // the eszip + multipart deploy endpoints.
  await app.register(
    async (mgmt) => {
      await mgmt.register(mgmtApiErrorsPlugin);
      await mgmt.register(multipart, {
        limits: { fileSize: 50 * 1024 * 1024, files: 100 },
      });
      // US1 — auth/profile/organizations:
      await mgmt.register(profileRoutes);
      await mgmt.register(organizationsRoutes);
      // US2 — projects + per-instance api-keys:
      await mgmt.register(projectsRoutes);
      await mgmt.register(apiKeysRoutes);
      // US3 — functions (deploy/list/get/body/delete + bulk + eszip variants):
      await mgmt.register(functionsRoutes);
      // US4 — secrets (list/set/delete):
      await mgmt.register(secretsRoutes);
      // Feature 006 US1 — gen types typescript:
      await mgmt.register(genTypesRoutes);
      // Feature 006 US2 — migrations list/upsert/delete:
      await mgmt.register(migrationsRoutes);
      // Feature 009 — runtime config tunables (postgres-config + auth-config):
      await mgmt.register(postgrestConfigRoutes);
      await mgmt.register(authConfigRoutes);
      // Feature 112 — realtime + pgbouncer store-only config:
      await mgmt.register(realtimeConfigRoutes);
      await mgmt.register(pgbouncerConfigRoutes);
      await mgmt.register(billingAddonsRoutes);
      await mgmt.register(postgresConfigRoutes);
      await mgmt.register(sslEnforcementRoutes);
      // Feature 012 — CLI login-role (passwordless `supabase db push`):
      await mgmt.register(cliLoginRoleRoutes);
      // Feature 013 — db query + db dump (ad-hoc SQL + pg_dump streaming):
      await mgmt.register(dbQueryRoutes);
      await mgmt.register(dbDumpRoutes);
      // Feature 014 — OAuth 2.1 authorization server (register/authorize/token):
      await mgmt.register(oauthRegisterRoutes);
      await mgmt.register(oauthAuthorizeRoutes);
      await mgmt.register(oauthTokenRoutes);
      // Feature 014 US4 — get_logs (Logflare forwarder):
      await mgmt.register(logsRoutes);
      // Feature 014 US5 — list_storage_buckets (storage reverse-proxy):
      await mgmt.register(storageBucketsRoutes);
      // Feature 014 US6 — pause_project + restore_project (async lifecycle):
      await mgmt.register(pauseRestoreRoutes);
      // Feature 019 — backup list + async restore (issue #14):
      await mgmt.register(backupsMgmtRoutes);
      // Catch-all MUST be last so real routes match first (FR-024).
      await mgmt.register(notImplementedRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  app.log.info({ port: PORT }, 'supastack api listening');

  // Daily cert-check job: sets renewal_due=true on certs within 30 days of expiry.
  if (REDIS_URL) {
    const certQueue = createCertCheckQueue(REDIS_URL);
    createCertCheckWorker(REDIS_URL);
    await certQueue.upsertJobScheduler(
      'daily-cert-check',
      { pattern: '0 2 * * *' },
      { name: 'cert-check', opts: { removeOnComplete: { count: 5 }, removeOnFail: { count: 10 } } },
    );
  }

  // pg-edge proxy: direct Postgres endpoint on :5432 (feature 005).
  // Only starts if apex is configured AND wildcard cert files exist on disk.
  const pgEdgeProxy = await maybeStartPgEdgeProxy(app);

  // Graceful shutdown
  const shutdown = async (sig: string): Promise<void> => {
    app.log.info({ sig }, 'shutting down');
    await pgEdgeProxy?.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function maybeStartPgEdgeProxy(app: FastifyInstance): Promise<PgEdgeProxy | null> {
  try {
    const apex = getApex();
    if (!apex) {
      app.log.info('pg-edge: skipped (no apex configured)');
      return null;
    }
    const certsDir = process.env.SUPASTACK_CERTS_DIR ?? '/var/supastack/certs';
    const certPath = `${certsDir}/${apex}/cert.pem`;
    const keyPath = `${certsDir}/${apex}/key.pem`;
    if (!existsSync(certPath) || !existsSync(keyPath)) {
      app.log.info({ certPath }, 'pg-edge: skipped (wildcard cert files not present)');
      return null;
    }
    return startPgEdgeProxy({
      port: Number(process.env.PG_EDGE_PROXY_PORT ?? 5432),
      certPath,
      keyPath,
      apexDomain: apex,
      redisUrl: REDIS_URL,
    });
  } catch (err) {
    app.log.error({ err: (err as Error).message }, 'pg-edge: failed to start');
    return null;
  }
}

function parseSqlTitle(sql: string): { title: string; description: string } {
  const s = sql.replace(/\s+/g, ' ').trim();
  const upper = s.toUpperCase();

  const extractTable = (pattern: RegExp) => {
    const m = s.match(pattern);
    if (!m?.[1]) return '';
    return m[1].replace(/^["'`]|["'`]$/g, '').replace(/^\w+\./, '');
  };

  let title: string;
  let description: string;

  if (upper.startsWith('SELECT')) {
    const table = extractTable(/\bFROM\s+([\w."'`]+)/i);
    const hasWhere = /\bWHERE\b/i.test(s);
    const hasJoin = /\bJOIN\b/i.test(s);
    const hasGroup = /\bGROUP\s+BY\b/i.test(s);
    const isCountStar = /SELECT\s+COUNT\s*\(/i.test(s);
    const selectAll = /SELECT\s+\*/i.test(s);
    if (isCountStar) {
      title = table ? `Count rows in ${table}` : 'Count rows';
      description = `Returns the number of rows${table ? ` in ${table}` : ''}${hasWhere ? ' matching the filter' : ''}.`;
    } else if (table) {
      title = selectAll
        ? `Select all from ${table}`
        : `Query ${table}${hasWhere ? ' with filter' : ''}${hasJoin ? ' with join' : ''}`;
      description = `Retrieves ${selectAll ? 'all columns' : 'selected columns'} from ${table}${hasGroup ? ', grouped by key' : ''}${hasWhere ? ', filtered by condition' : ''}.`;
    } else {
      title = 'SQL Query';
      description = 'Executes a SELECT statement.';
    }
  } else if (upper.startsWith('INSERT')) {
    const table = extractTable(/\bINTO\s+([\w."'`]+)/i);
    title = table ? `Insert into ${table}` : 'Insert rows';
    description = `Inserts one or more rows${table ? ` into ${table}` : ''}.`;
  } else if (upper.startsWith('UPDATE')) {
    const table = extractTable(/^UPDATE\s+([\w."'`]+)/i);
    title = table ? `Update ${table}` : 'Update rows';
    description = `Updates rows${table ? ` in ${table}` : ''}${/\bWHERE\b/i.test(s) ? ' matching the filter' : ''}.`;
  } else if (upper.startsWith('DELETE')) {
    const table = extractTable(/\bFROM\s+([\w."'`]+)/i);
    title = table ? `Delete from ${table}` : 'Delete rows';
    description = `Deletes rows${table ? ` from ${table}` : ''}${/\bWHERE\b/i.test(s) ? ' matching the filter' : ''}.`;
  } else if (upper.startsWith('CREATE TABLE')) {
    const table = extractTable(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."'`]+)/i);
    title = table ? `Create table ${table}` : 'Create table';
    description = `Creates the ${table || 'new'} table with the specified columns and constraints.`;
  } else if (upper.startsWith('DROP TABLE')) {
    const table = extractTable(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."'`]+)/i);
    title = table ? `Drop table ${table}` : 'Drop table';
    description = `Drops the ${table || 'specified'} table${/\bCASCADE\b/i.test(s) ? ' and all dependent objects' : ''}.`;
  } else if (upper.startsWith('ALTER TABLE')) {
    const table = extractTable(/ALTER\s+TABLE\s+([\w."'`]+)/i);
    title = table ? `Alter table ${table}` : 'Alter table';
    description = `Modifies the structure of ${table ? `the ${table} table` : 'a table'}.`;
  } else if (upper.startsWith('CREATE INDEX')) {
    const table = extractTable(/\bON\s+([\w."'`]+)/i);
    title = table ? `Create index on ${table}` : 'Create index';
    description = `Creates an index${table ? ` on ${table}` : ''} to improve query performance.`;
  } else if (upper.startsWith('TRUNCATE')) {
    const table = extractTable(/^TRUNCATE\s+(?:TABLE\s+)?([\w."'`]+)/i);
    title = table ? `Truncate ${table}` : 'Truncate table';
    description = `Removes all rows from ${table ? `${table}` : 'the table'}.`;
  } else {
    const firstWord = (s.split(/\s/)[0] ?? 'SQL').toUpperCase();
    title = `${firstWord.charAt(0) + firstWord.slice(1).toLowerCase()} statement`;
    description = `Executes a ${firstWord} statement.`;
  }

  return { title, description };
}

// Suppress unused import warning — eq isn't directly used here but kept for
// future selectors in this module (server-startup queries).
void eq;

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // Use stderr because logger may not be initialized yet on early failure.
    console.error('startup failed:', err);
    process.exit(1);
  });
}
