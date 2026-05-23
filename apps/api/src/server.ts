import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { AppError, errors } from '@selfbase/shared';
import { loadMasterKey } from '@selfbase/crypto';
import { makeDb, migrate } from '@selfbase/db';
import { authPlugin } from './plugins/auth.js';
import { rbacPlugin } from './plugins/rbac.js';
import { mgmtApiErrorsPlugin } from './plugins/mgmt-api-errors.js';
import { tlsAskRoutes } from './routes/tls-ask.js';
import { caddyInternalRoutes } from './routes/caddy-internal.js';
import { healthRoutes } from './routes/health.js';
import { setupRoutes } from './routes/setup.js';
import { authRoutes } from './routes/auth.js';
import { instancesRoutes } from './routes/instances.js';
import { backupsRoutes } from './routes/backups.js';
import { orgRoutes } from './routes/org.js';
import { apexRoutes } from './routes/apex.js';
import { membersRoutes } from './routes/members.js';
import { auditRoutes } from './routes/audit.js';
import { notImplementedRoutes } from './routes/management/not-implemented.js';
import { profileRoutes } from './routes/management/profile.js';
import { organizationsRoutes } from './routes/management/organizations.js';
import { projectsRoutes } from './routes/management/projects.js';
import { apiKeysRoutes } from './routes/management/api-keys.js';
import { functionsRoutes } from './routes/management/functions.js';
import { secretsRoutes } from './routes/management/secrets.js';
import { genTypesRoutes } from './routes/management/gen-types.js';
import { connectCliRoutes } from './routes/connect-cli.js';
import { wildcardCertRoutes } from './routes/wildcard-certs.js';
import { acmeChallengeRoutes } from './routes/acme-challenge.js';
import { pgEdgeCertInternalRoutes } from './routes/pg-edge-cert-internal.js';
import { poolerInternalRoutes } from './routes/pooler-internal.js';
import { createCertCheckQueue, createCertCheckWorker } from './services/cert-check.js';
import { startPgEdgeProxy, type PgEdgeProxy } from './services/pg-edge-proxy.js';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';

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

  // DB
  makeDb(DATABASE_URL);
  await migrate(DATABASE_URL);

  // Use Fastify's own pino with LoggerOptions — avoids the v4 instance-type
  // mismatch between our shared logger's full pino.Logger and Fastify's
  // FastifyBaseLogger interface. Our @selfbase/shared logger remains the
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
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  // Uniform error formatter. Dashboard surface (everything except /v1) uses
  // selfbase's envelope `{error: {code, message}}`; the CLI compat surface
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
  await app.register(cors, { origin: true, credentials: true });
  await app.register(authPlugin);
  await app.register(rbacPlugin);

  // Routes — public under /api/v1, internal endpoints at root
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(setupRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(orgRoutes, { prefix: '/api/v1' });
  await app.register(apexRoutes, { prefix: '/api/v1' });
  await app.register(instancesRoutes, { prefix: '/api/v1' });
  await app.register(backupsRoutes, { prefix: '/api/v1' });
  await app.register(membersRoutes, { prefix: '/api/v1' });
  await app.register(auditRoutes, { prefix: '/api/v1' });
  await app.register(connectCliRoutes, { prefix: '/api/v1' });
  await app.register(wildcardCertRoutes, { prefix: '/api/v1' });
  await app.register(tlsAskRoutes); // /internal/tls/ask
  await app.register(caddyInternalRoutes); // /internal/caddy/reload
  await app.register(acmeChallengeRoutes); // /.well-known/acme-challenge/:token (HTTP-01)
  await app.register(pgEdgeCertInternalRoutes); // /internal/pg-edge-cert/issue
  await app.register(poolerInternalRoutes); // /internal/pooler/tenants

  // ─── /v1/* — Supabase Management API compatibility surface ─────────────
  //
  // Spec: specs/003-supabase-cli-compat-p0/plan.md
  //
  // The mgmtApiErrorsPlugin replaces the global error formatter inside this
  // scope (Fastify encapsulation) so responses match the cloud's envelope
  // `{ message, code?, details? }` instead of selfbase's dashboard shape.
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
  app.log.info({ port: PORT }, 'selfbase api listening');

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

async function maybeStartPgEdgeProxy(
  app: FastifyInstance,
): Promise<PgEdgeProxy | null> {
  try {
    const [orgRow] = await db()
      .select({ apex: schema.org.apexDomain })
      .from(schema.org)
      .limit(1);
    const apex = orgRow?.apex;
    if (!apex) {
      app.log.info('pg-edge: skipped (no apex configured)');
      return null;
    }
    const certsDir = process.env.SELFBASE_CERTS_DIR ?? '/var/selfbase/certs';
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
