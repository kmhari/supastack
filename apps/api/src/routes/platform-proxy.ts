import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  resolveInstance,
  proxyToKong,
  ProxyProjectNotFoundError,
  ProxyProjectPausedError,
  ProxyUpstreamError,
} from '../services/platform-proxy-helpers.js';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
import type { InstanceSecrets } from '../services/instance-secrets.js';

async function readBody(req: { raw: import('node:http').IncomingMessage }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req.raw) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

const STRIP_REQUEST_HEADERS = new Set(['x-connection-encrypted']);
const STRIP_RESPONSE_HEADERS = new Set([
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
  'access-control-expose-headers',
]);

async function handleProxy(
  app: Parameters<FastifyPluginAsync>[0],
  req: FastifyRequest<{ Params: { ref: string } }>,
  reply: FastifyReply,
  upstreamPrefix: string,
  pathSuffix: string,
  kongAuth?: 'apikey' | 'bearer',
): Promise<void> {
  app.requireAuth(req);

  const { ref } = req.params;

  let instance: Awaited<ReturnType<typeof resolveInstance>>;
  try {
    instance = await resolveInstance(ref);
  } catch (err) {
    if (err instanceof ProxyProjectNotFoundError) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    if (err instanceof ProxyProjectPausedError) {
      return reply.status(503).send({ error: 'Project is paused' });
    }
    throw err;
  }

  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstreamPath = `${upstreamPrefix}${pathSuffix}${qs}`;
  const body = await readBody(req);

  const forwardHeaders: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) {
      forwardHeaders[k] = v;
    }
  }
  // Inject Kong auth for admin routes.
  // Kong key-auth uses 'apikey' header to identify the service_role consumer (admin ACL).
  // GoTrue/meta also need Authorization: Bearer <service_role_key> for their own auth.
  if (kongAuth === 'apikey') {
    forwardHeaders['apikey'] = instance.serviceRoleKey;
    forwardHeaders['authorization'] = `Bearer ${instance.serviceRoleKey}`;
  }

  let result: Awaited<ReturnType<typeof proxyToKong>>;
  try {
    result = await proxyToKong(instance.portKong, upstreamPath, req.method, forwardHeaders, body);
  } catch (err) {
    if (err instanceof ProxyUpstreamError) {
      return reply.status(err.status).send({ error: err.message });
    }
    throw err;
  }

  for (const [k, v] of Object.entries(result.headers)) {
    if (!STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) {
      reply.header(k, v);
    }
  }
  return reply.status(result.status).send(result.body);
}

export const platformProxyRoutes: FastifyPluginAsync = async (app) => {
  // ── pg-meta proxy ──────────────────────────────────────────────────────────
  // Kong routes /pg/* → meta:8080 (strip_path=true, so /pg/tables → meta /tables).
  // Studio sends /platform/pg-meta/:ref/tables → we forward to /pg/tables via Kong.
  // Kong's meta-all route requires dashboard apikey + admin ACL.
  app.route<{ Params: { ref: string; '*': string } }>({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/platform/pg-meta/:ref/*',
    handler: (req, reply) =>
      handleProxy(app, req as FastifyRequest<{ Params: { ref: string } }>, reply, '/pg/', (req.params as { ref: string; '*': string })['*'], 'apikey'),
  });

  // ── storage proxy ──────────────────────────────────────────────────────────
  // Studio calls /platform/storage/:ref/buckets/* but storage API uses /bucket/* (singular).
  // Kong route /storage/v1/ → storage:5000 with strip_path=true.
  // Auth: storage uses request-transformer that validates JWT via GoTrue — pass service role.
  app.route<{ Params: { ref: string; '*': string } }>({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/platform/storage/:ref/*',
    handler: async (req, reply) => {
      app.requireAuth(req);
      const ref = req.params.ref;
      const inst = await resolveInstance(ref).catch(() => null);
      if (!inst) return reply.status(404).send({ error: 'Project not found' });

      const suffix = (req.params as { ref: string; '*': string })['*'];
      // Rewrite: buckets → bucket (storage API uses singular)
      const upstreamSuffix = suffix.replace(/^buckets/, 'bucket');
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const body = await readBody(req);
      const upstreamPath = `/storage/v1/${upstreamSuffix}${qs}`;
      // Inject service role JWT as Authorization — storage validates via GoTrue
      const forwardHeaders = { ...req.headers, authorization: `Bearer ${inst.serviceRoleKey}` } as Record<string, string | string[] | undefined>;
      for (const k of STRIP_REQUEST_HEADERS) delete forwardHeaders[k];

      let result: Awaited<ReturnType<typeof proxyToKong>>;
      try {
        result = await proxyToKong(inst.portKong, upstreamPath, req.method, forwardHeaders, body);
      } catch (err) {
        if (err instanceof ProxyUpstreamError) return reply.status(err.status).send({ error: err.message });
        throw err;
      }
      for (const [k, v] of Object.entries(result.headers)) {
        if (!STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) reply.header(k, v as string);
      }
      return reply.status(result.status).send(result.body);
    },
  });

  // ── auth admin proxy ───────────────────────────────────────────────────────
  // Kong auth route needs: apikey (key-auth) + Authorization: Bearer (GoTrue admin auth).
  app.route<{ Params: { ref: string; '*': string } }>({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/platform/auth/:ref/users*',
    handler: (req, reply) => {
      const suffix = (req.params as { ref: string; '*': string })['*'] ?? '';
      return handleProxy(app, req as FastifyRequest<{ Params: { ref: string } }>, reply, '/auth/v1/admin/users', suffix, 'apikey');
    },
  });

  // Invite → POST /auth/v1/admin/users
  app.post<{ Params: { ref: string } }>(
    '/platform/auth/:ref/invite',
    (req, reply) => handleProxy(app, req, reply, '/auth/v1/admin/users', '', 'apikey'),
  );

  // Magic link / OTP / recover → generate_link
  for (const endpoint of ['magiclink', 'otp', 'recover'] as const) {
    app.post<{ Params: { ref: string } }>(
      `/platform/auth/:ref/${endpoint}`,
      (req, reply) => handleProxy(app, req, reply, '/auth/v1/admin/generate_link', '', 'apikey'),
    );
  }

  // ── analytics proxy ────────────────────────────────────────────────────────
  // Kong route: /analytics/v1/api/endpoints/ → analytics:4000/api/endpoints/
  // Studio sends /platform/projects/:ref/analytics/endpoints/logs.all
  // → forward to /analytics/v1/api/endpoints/logs.all
  app.route<{ Params: { ref: string; '*': string } }>({
    method: ['GET', 'POST'],
    url: '/platform/projects/:ref/analytics/*',
    handler: (req, reply) =>
      handleProxy(app, req as FastifyRequest<{ Params: { ref: string } }>, reply, '/analytics/v1/api/endpoints/', (req.params as { ref: string; '*': string })['*']),
  });
};
