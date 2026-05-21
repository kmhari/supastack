import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { AppError, errors } from '@selfbase/shared';
import { loadMasterKey } from '@selfbase/crypto';
import { makeDb, migrate } from '@selfbase/db';
import { authPlugin } from './plugins/auth.js';
import { rbacPlugin } from './plugins/rbac.js';
import { tlsAskRoutes } from './routes/tls-ask.js';
import { caddyInternalRoutes } from './routes/caddy-internal.js';
import { healthRoutes } from './routes/health.js';
import { setupRoutes } from './routes/setup.js';
import { authRoutes } from './routes/auth.js';
import { instancesRoutes } from './routes/instances.js';
import { backupsRoutes } from './routes/backups.js';
import { orgRoutes } from './routes/org.js';

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
    bodyLimit: 5 * 1024 * 1024,
    disableRequestLogging: false,
  });

  // Uniform error formatter.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send(err.toBody());
      return;
    }
    if ((err as { validation?: unknown }).validation) {
      reply.status(400).send(errors.invalidInput(err.message).toBody());
      return;
    }
    req.log.error({ err }, 'unhandled error');
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
  await app.register(instancesRoutes, { prefix: '/api/v1' });
  await app.register(backupsRoutes, { prefix: '/api/v1' });
  await app.register(tlsAskRoutes); // /internal/tls/ask
  await app.register(caddyInternalRoutes); // /internal/caddy/reload

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  app.log.info({ port: PORT }, 'selfbase api listening');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // Use stderr because logger may not be initialized yet on early failure.
    console.error('startup failed:', err);
    process.exit(1);
  });
}
