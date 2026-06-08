import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  resolveInstance,
  proxyToKong,
  ProxyProjectNotFoundError,
  ProxyProjectPausedError,
  ProxyUpstreamError,
} from '../services/platform-proxy-helpers.js';

// Forward the request body to Kong. By the time the handler runs, Fastify has
// already parsed the body (default JSON parser → object; server.ts buffer
// parsers → Buffer; urlencoded → string) AND parsing drains `req.raw`, so
// reading the raw stream here returns empty for any parsed content type — that
// was the JSON-POST body-drop bug (SQL exec/writes 500'd). Derive the bytes from
// the already-parsed `req.body` instead. `content-length` is stripped below so
// undici recomputes it from the actual buffer (re-serialized JSON may differ in
// length from the original).
function bodyOf(req: { body?: unknown }): Buffer {
  const b = req.body;
  if (b === undefined || b === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') return Buffer.from(b);
  return Buffer.from(JSON.stringify(b));
}

/**
 * Rewrite Studio storage path suffixes to match the storage-api route shape.
 *
 * Studio calls:  buckets/test/objects/list      → storage: object/list/test
 *                buckets/test/objects/file.jpg   → storage: object/test/file.jpg
 *                buckets/test/objects            → storage: object/test  (upload root)
 *                buckets / buckets/test          → storage: bucket / bucket/test
 */
function rewriteStoragePath(suffix: string): string {
  // buckets/:bucket/objects/list → object/list/:bucket  (POST list)
  const listMatch = suffix.match(/^buckets\/([^/]+)\/objects\/list$/);
  if (listMatch) return `object/list/${listMatch[1]}`;

  // buckets/:bucket/objects[/rest] → object/:bucket[/rest]  (upload, download, delete, sign)
  const objectMatch = suffix.match(/^buckets\/([^/]+)\/objects(\/.*)?$/);
  if (objectMatch) return `object/${objectMatch[1]}${objectMatch[2] ?? ''}`;

  // buckets[/rest] → bucket[/rest]  (list buckets, create, get, update, delete)
  return suffix.replace(/^buckets/, 'bucket');
}

/**
 * Studio IS_PLATFORM sends list-objects as { path, options: { limit, offset, search, sortBy } }
 * but storage-api expects { prefix, limit, offset, search, sortBy } (flat, prefix not path).
 */
function normalizeObjectListBody(req: { method: string; params: Record<string, unknown>; body?: unknown }): void {
  if (req.method !== 'POST') return;
  const suffix = req.params['*'] as string | undefined;
  if (!suffix?.match(/^buckets\/[^/]+\/objects\/list$/)) return;
  const b = req.body as Record<string, unknown> | null | undefined;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return;
  if ('prefix' in b) return; // already in correct format
  const opts = (b.options ?? {}) as Record<string, unknown>;
  req.body = {
    prefix: b.path ?? '',
    limit: opts.limit ?? 100,
    offset: opts.offset ?? 0,
    search: opts.search ?? '',
    sortBy: opts.sortBy ?? { column: 'name', order: 'asc' },
  };
}

/**
 * Newer Studio posts bucket-create as `{ id, type, public }`, but the bundled
 * per-instance storage-api requires `name` (→ 400 "must have required property
 * 'name'"). Backfill `name` from `id` (Studio's create dialog uses one value for
 * both) so the bucket is created. Mutates `req.body` in place. Scoped to
 * `POST .../buckets` — the only shape we've confirmed the upstream schema accepts.
 */
function backfillBucketName(req: { method: string; params: Record<string, unknown>; body?: unknown }): void {
  if (req.method !== 'POST') return;
  if ((req.params['*'] as string | undefined) !== 'buckets') return;
  const b = req.body as Record<string, unknown> | null | undefined;
  if (
    b &&
    typeof b === 'object' &&
    !Array.isArray(b) &&
    (b.name === undefined || b.name === null) &&
    typeof b.id === 'string'
  ) {
    b.name = b.id;
  }
}

const STRIP_REQUEST_HEADERS = new Set(['x-connection-encrypted', 'content-length']);
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
  const body = bodyOf(req);

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
      const upstreamSuffix = rewriteStoragePath(suffix);
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      // Newer Studio sends bucket-create as {id,type,public}; storage-api needs `name`.
      backfillBucketName(req);
      // Studio IS_PLATFORM sends list-objects as { path, options:{...} }; storage-api needs { prefix, limit, ... }.
      normalizeObjectListBody(req);
      const body = bodyOf(req);
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
      // The `*` suffix already includes `endpoints/...` (e.g. `endpoints/logs.all`),
      // so the prefix is `/analytics/v1/api/` — NOT `/analytics/v1/api/endpoints/`,
      // which doubled to `/analytics/v1/api/endpoints/endpoints/logs.all`.
      handleProxy(app, req as FastifyRequest<{ Params: { ref: string } }>, reply, '/analytics/v1/api/', (req.params as { ref: string; '*': string })['*']),
  });
};
