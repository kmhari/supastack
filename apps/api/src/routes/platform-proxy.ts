import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Action } from '@supastack/shared';
import {
  authorizeAndResolveInstance,
  proxyToKong,
  type InstanceProxy,
  ProxyProjectNotFoundError,
  ProxyProjectPausedError,
  ProxyUpstreamError,
} from '../services/platform-proxy-helpers.js';

// Org-scoped resolve for the inline proxy handlers (SEC-001). Returns the
// instance, or sends the right error reply and returns null. Reads use
// `instance.read`; mutations use the passed `writeAction`. A non-member gets 404
// (no existence leak); an under-privileged member gets 403 (thrown → global).
async function resolveOrReply(
  app: Parameters<FastifyPluginAsync>[0],
  req: FastifyRequest,
  reply: FastifyReply,
  writeAction: Action,
  ref: string,
): Promise<InstanceProxy | null> {
  const action: Action =
    req.method === 'GET' || req.method === 'HEAD' ? 'instance.read' : writeAction;
  try {
    return await authorizeAndResolveInstance(app, req, action, ref);
  } catch (err) {
    if (err instanceof ProxyProjectNotFoundError) {
      reply.status(404).send({ error: 'Project not found' });
      return null;
    }
    if (err instanceof ProxyProjectPausedError) {
      reply.status(503).send({ error: 'Project is paused' });
      return null;
    }
    throw err; // forbidden (403) + unexpected → global error formatter
  }
}

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
export function rewriteStoragePath(suffix: string): string {
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
 * Studio sends analytics calls as `endpoints/<name>` (e.g. `endpoints/logs.all`),
 * but Logflare's run-by-name route is `endpoints/query/<name>`. Insert `query/`
 * idempotently: a suffix already targeting `query/…` is forwarded verbatim, which
 * lets the proxy be probed via `endpoints/query/<name>` while the legacy
 * single-segment `endpoints/:name` stub still shadows `endpoints/<name>`.
 * Non-`endpoints/` suffixes (other analytics paths) pass through unchanged.
 */
export function rewriteAnalyticsPath(suffix: string): string {
  return suffix.replace(/^endpoints\/(?!query\/)/, 'endpoints/query/');
}

/**
 * Self-hosted vector stamps every log event `project = "default"` (see the
 * per-instance vector.yml `project_logs` transform), and the `logs.all` /
 * endpoint-query CTEs filter `where t.project = @project`. Supabase Cloud binds
 * @project server-side at its API edge; Studio never sends it. So append
 * `project=default` to endpoint-query calls or every row is filtered out.
 * Idempotent + scoped: only `endpoints/…` paths, and an explicit `project=` wins.
 */
export function injectAnalyticsProject(upstreamSuffix: string, qs: string): string {
  if (!upstreamSuffix.startsWith('endpoints/')) return qs;
  if (/[?&]project=/.test(qs)) return qs;
  return qs ? `${qs}&project=default` : '?project=default';
}

/**
 * Real log-query endpoints whose upstream errors are surfaced to the caller —
 * the Logs Explorer is user-driven (bad SQL etc.) and needs that feedback.
 */
const REAL_LOG_QUERY_ENDPOINTS = new Set(['logs.all', 'logs.all.otel']);

/**
 * Whether an upstream analytics error should degrade to `{ result: [] }` (HTTP 200)
 * instead of propagating. True for the Cloud-only metric endpoints (usage.*,
 * service-health, auth.metrics, functions.*) that self-hosted Logflare does not
 * implement — they fire automatically on `IS_PLATFORM` pages and must stay benign,
 * exactly as the old platform-misc stub did. False for the real log-query endpoints
 * (logs.all / logs.all.otel), whose errors are surfaced.
 */
export function suppressAnalyticsErrorToEmpty(upstreamSuffix: string): boolean {
  if (!upstreamSuffix.startsWith('endpoints/query/')) return false;
  const name = upstreamSuffix.slice('endpoints/query/'.length);
  return !REAL_LOG_QUERY_ENDPOINTS.has(name);
}

/**
 * Studio IS_PLATFORM sends list-objects as { path, options: { limit, offset, search, sortBy } }
 * but storage-api expects { prefix, limit, offset, search, sortBy } (flat, prefix not path).
 */
export function normalizeObjectListBody(req: {
  method: string;
  params: Record<string, unknown>;
  body?: unknown;
}): void {
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
 * Studio (IS_PLATFORM) sends DELETE .../buckets/:bucket/objects with body
 * { paths: string[] } (platform API shape, per platform.d.ts DeleteObjectsBody).
 * storage-api DELETE /object/:bucket expects { prefixes: string[] }.
 * Translate in place.
 */
export function normalizeDeleteObjectsBody(req: {
  method: string;
  params: Record<string, unknown>;
  body?: unknown;
}): void {
  if (req.method !== 'DELETE') return;
  const suffix = req.params['*'] as string | undefined;
  if (!suffix?.match(/^buckets\/[^/]+\/objects$/)) return;
  const b = req.body as Record<string, unknown> | null | undefined;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return;
  if ('prefixes' in b) return; // already correct
  if (Array.isArray(b.paths)) {
    req.body = { prefixes: b.paths };
  }
}

/**
 * Studio IS_PLATFORM sends PATCH to update a single bucket, but storage-api
 * registers updateBucket as PUT /:bucketId. Rewrite the method when the suffix
 * matches exactly `buckets/:id` (individual bucket — not objects, not list).
 */
export function rewriteBucketUpdateMethod(suffix: string, method: string): string {
  if (method === 'PATCH' && /^buckets\/[^/]+$/.test(suffix)) return 'PUT';
  return method;
}

/**
 * Newer Studio posts bucket-create as `{ id, type, public }`, but the bundled
 * per-instance storage-api requires `name` (→ 400 "must have required property
 * 'name'"). Backfill `name` from `id` (Studio's create dialog uses one value for
 * both) so the bucket is created. Mutates `req.body` in place. Scoped to
 * `POST .../buckets` — the only shape we've confirmed the upstream schema accepts.
 */
export function backfillBucketName(req: {
  method: string;
  params: Record<string, unknown>;
  body?: unknown;
}): void {
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
  kongAuth: 'apikey' | 'bearer' | undefined,
  writeAction: Action,
): Promise<void> {
  const { ref } = req.params;

  const instance = await resolveOrReply(app, req, reply, writeAction, ref);
  if (!instance) return; // 404/503 already sent

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
      handleProxy(
        app,
        req as FastifyRequest<{ Params: { ref: string } }>,
        reply,
        '/pg/',
        (req.params as { ref: string; '*': string })['*'],
        'apikey',
        'database.write', // pg-meta = SQL/DDL on writes; reads downgrade to instance.read
      ),
  });

  // ── storage / public-url ───────────────────────────────────────────────────
  // Studio IS_PLATFORM calls POST /platform/storage/:ref/buckets/:bucket/objects/public-url
  // with body { path: string, options?: { download?, transform? } } and expects
  // { publicUrl: string }. There is no matching storage-api endpoint; the URL is
  // constructed from the apex env var. Must be registered before the wildcard route.
  app.post<{ Params: { ref: string; bucket: string } }>(
    '/platform/storage/:ref/buckets/:bucket/objects/public-url',
    async (req, reply) => {
      const { ref, bucket } = req.params;
      const inst = await resolveOrReply(app, req, reply, 'instance.read', ref);
      if (!inst) return;

      const body = req.body as Record<string, unknown> | null | undefined;
      const objectPath =
        body && typeof body === 'object' && typeof body.path === 'string' ? body.path : '';
      const opts =
        body && typeof body === 'object' && body.options && typeof body.options === 'object'
          ? (body.options as Record<string, unknown>)
          : {};

      const apex = process.env.SUPASTACK_APEX ?? '';
      const base = apex ? `https://${ref}.${apex}` : `http://localhost:${inst.portKong}`;
      const urlBase = `${base}/storage/v1/object/public/${bucket}/${objectPath}`;

      // Build optional query params from transform/download options
      const params: string[] = [];
      if (opts.download !== undefined)
        params.push(
          `download=${opts.download === true ? '' : encodeURIComponent(String(opts.downloadName ?? ''))}`,
        );
      if (opts.transform && typeof opts.transform === 'object') {
        const t = opts.transform as Record<string, unknown>;
        if (t.width !== undefined) params.push(`width=${t.width}`);
        if (t.height !== undefined) params.push(`height=${t.height}`);
        if (t.quality !== undefined) params.push(`quality=${t.quality}`);
        if (t.resize !== undefined) params.push(`resize=${t.resize}`);
        if (t.format !== undefined) params.push(`format=${t.format}`);
      }
      const publicUrl = params.length > 0 ? `${urlBase}?${params.join('&')}` : urlBase;
      return reply.send({ publicUrl });
    },
  );

  // ── storage proxy ──────────────────────────────────────────────────────────
  // Studio calls /platform/storage/:ref/buckets/* but storage API uses /bucket/* (singular).
  // Kong route /storage/v1/ → storage:5000 with strip_path=true.
  // Auth: storage uses request-transformer that validates JWT via GoTrue — pass service role.
  app.route<{ Params: { ref: string; '*': string } }>({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/platform/storage/:ref/*',
    handler: async (req, reply) => {
      const ref = req.params.ref;
      const inst = await resolveOrReply(app, req, reply, 'instance.update', ref);
      if (!inst) return;

      const suffix = (req.params as { ref: string; '*': string })['*'];
      const upstreamSuffix = rewriteStoragePath(suffix);
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      // Newer Studio sends bucket-create as {id,type,public}; storage-api needs `name`.
      backfillBucketName(req);
      // Studio IS_PLATFORM sends list-objects as { path, options:{...} }; storage-api needs { prefix, limit, ... }.
      normalizeObjectListBody(req);
      // Studio sends DELETE objects as { paths:[...] } (platform shape); storage-api needs { prefixes:[...] }.
      normalizeDeleteObjectsBody(req);
      const body = bodyOf(req);
      const upstreamPath = `/storage/v1/${upstreamSuffix}${qs}`;
      // storage-api registers updateBucket as PUT /:bucketId; Studio sends PATCH — rewrite.
      const upstreamMethod = rewriteBucketUpdateMethod(suffix, req.method);
      // Inject service role JWT as Authorization — storage validates via GoTrue
      const forwardHeaders = {
        ...req.headers,
        authorization: `Bearer ${inst.serviceRoleKey}`,
      } as Record<string, string | string[] | undefined>;
      for (const k of STRIP_REQUEST_HEADERS) delete forwardHeaders[k];

      let result: Awaited<ReturnType<typeof proxyToKong>>;
      try {
        result = await proxyToKong(
          inst.portKong,
          upstreamPath,
          upstreamMethod,
          forwardHeaders,
          body,
        );
      } catch (err) {
        if (err instanceof ProxyUpstreamError)
          return reply.status(err.status).send({ error: err.message });
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
      return handleProxy(
        app,
        req as FastifyRequest<{ Params: { ref: string } }>,
        reply,
        '/auth/v1/admin/users',
        suffix,
        'apikey',
        'instance.update', // GoTrue admin user CRUD = developer+; reads downgrade to instance.read
      );
    },
  });

  // Invite → POST /auth/v1/admin/users
  app.post<{ Params: { ref: string } }>('/platform/auth/:ref/invite', (req, reply) =>
    handleProxy(app, req, reply, '/auth/v1/admin/users', '', 'apikey', 'instance.update'),
  );

  // Magic link / OTP / recover → generate_link
  for (const endpoint of ['magiclink', 'otp', 'recover'] as const) {
    app.post<{ Params: { ref: string } }>(`/platform/auth/:ref/${endpoint}`, (req, reply) =>
      handleProxy(app, req, reply, '/auth/v1/admin/generate_link', '', 'apikey', 'instance.update'),
    );
  }

  // ── analytics proxy ────────────────────────────────────────────────────────
  // Kong route /analytics/v1/api/endpoints/ → analytics:4000/api/endpoints/ is a
  // bare pass-through (no key-auth). Logflare's run-by-name route is
  // /api/endpoints/query/:name and authenticates via X-API-KEY:
  // <logflarePrivateAccessToken> — NOT the dashboard bearer (probe: bearer/no-key
  // → 401; endpoints/<name> without query/ → 400). So: rewrite endpoints/<name> →
  // endpoints/query/<name> (idempotent) and inject the per-instance Logflare key,
  // mirroring services/logflare-client.ts (the proven /v1 + MCP get_logs path).
  app.route<{ Params: { ref: string; '*': string } }>({
    method: ['GET', 'POST'],
    url: '/platform/projects/:ref/analytics/*',
    handler: async (req, reply) => {
      const inst = await resolveOrReply(app, req, reply, 'instance.read', req.params.ref);
      if (!inst) return;

      const suffix = (req.params as { ref: string; '*': string })['*'];
      const upstreamSuffix = rewriteAnalyticsPath(suffix);
      const rawQs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const qs = injectAnalyticsProject(upstreamSuffix, rawQs);

      const forwardHeaders: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) forwardHeaders[k] = v;
      }
      // Logflare authenticates via X-API-KEY; never leak the dashboard bearer upstream.
      delete forwardHeaders['authorization'];
      delete forwardHeaders['apikey'];
      forwardHeaders['x-api-key'] = inst.logflarePrivateAccessToken;

      const suppressErr = suppressAnalyticsErrorToEmpty(upstreamSuffix);

      let result: Awaited<ReturnType<typeof proxyToKong>>;
      try {
        result = await proxyToKong(
          inst.portKong,
          `/analytics/v1/api/${upstreamSuffix}${qs}`,
          req.method,
          forwardHeaders,
          bodyOf(req),
        );
      } catch (err) {
        if (err instanceof ProxyUpstreamError) {
          if (suppressErr) {
            app.log.warn(
              { ref: req.params.ref, endpoint: upstreamSuffix, status: err.status },
              'analytics endpoint unreachable — returning empty (Cloud-only metric)',
            );
            return reply.status(200).send({ result: [] });
          }
          return reply.status(err.status).send({ error: err.message });
        }
        throw err;
      }
      // Cloud-only metric endpoints aren't implemented self-hosted (undefined → 401,
      // BigQuery-dialect → 500). Degrade their errors to empty so IS_PLATFORM panels
      // stay benign; real log queries (logs.all) surface their errors unchanged.
      if (suppressErr && result.status >= 400) {
        app.log.warn(
          { ref: req.params.ref, endpoint: upstreamSuffix, status: result.status },
          'analytics endpoint unavailable self-hosted — returning empty (Cloud-only metric)',
        );
        return reply.status(200).send({ result: [] });
      }
      for (const [k, v] of Object.entries(result.headers)) {
        if (!STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) reply.header(k, v as string);
      }
      return reply.status(result.status).send(result.body);
    },
  });
};
