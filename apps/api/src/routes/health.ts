import type { FastifyPluginAsync } from 'fastify';
import { Redis } from 'ioredis';
import { fetch } from 'undici';
import { sql } from 'drizzle-orm';
import { db } from '@selfbase/db';

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL ?? 'http://caddy:2019';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => {
    const probes = await Promise.allSettled([
      db().execute(sql`SELECT 1`),
      probeRedis(),
      probeCaddy(),
    ]);
    const [dbR, redisR, caddyR] = probes;
    const status: Record<string, 'ok' | 'fail'> = {
      db: dbR.status === 'fulfilled' ? 'ok' : 'fail',
      redis: redisR.status === 'fulfilled' ? 'ok' : 'fail',
      caddy: caddyR.status === 'fulfilled' ? 'ok' : 'fail',
    };
    const ok = Object.values(status).every((v) => v === 'ok');
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', deps: status });
  });
};

async function probeRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL missing');
  const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0 });
  try {
    await r.connect();
    const pong = await r.ping();
    if (pong !== 'PONG') throw new Error('unexpected reply');
  } finally {
    r.disconnect();
  }
}

async function probeCaddy(): Promise<void> {
  const res = await fetch(`${CADDY_ADMIN_URL}/config/`);
  if (!res.ok) throw new Error(`caddy ${res.status}`);
}
