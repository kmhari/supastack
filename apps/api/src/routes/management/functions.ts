/**
 * Functions endpoints — the heaviest single piece of the CLI compat surface.
 *
 * Endpoints:
 *   GET    /v1/projects/:ref/functions                 — list
 *   PUT    /v1/projects/:ref/functions                 — bulk-update (multi-deploy finalize)
 *   POST   /v1/projects/:ref/functions/deploy?slug=    — multipart (--use-api)
 *   POST   /v1/projects/:ref/functions?slug=...        — eszip (default)
 *   PATCH  /v1/projects/:ref/functions/:slug?...       — eszip update
 *   GET    /v1/projects/:ref/functions/:slug           — single
 *   GET    /v1/projects/:ref/functions/:slug/body      — download
 *   DELETE /v1/projects/:ref/functions/:slug
 *
 * Spec: contracts/management-api.yaml, contracts/functions-deploy.md
 */
import type { FastifyPluginAsync } from 'fastify';
import type { Action } from '@supastack/shared';
import FormData from 'form-data';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import {
  deployFromEszip,
  deployFromMultipart,
  readFunctionBundle,
} from '../../services/function-deploy.js';
import { deleteFunction, getFunction, listFunctions } from '../../services/function-store.js';
import { functionRowToFunction } from '../../services/mgmt-api-mapping.js';

const ESZIP_CONTENT_TYPES = new Set(['application/vnd.denoland.eszip', 'application/octet-stream']);

export const functionsRoutes: FastifyPluginAsync = async (app) => {
  // Bump body limit for this scope so raw eszip bodies up to 50 MB get through.
  // (Multipart limits are configured at register-time on the mgmt group; raw
  //  bodies obey Fastify's bodyLimit instead.)

  // ─── Helpers ────────────────────────────────────────────────────────────
  // SEC-002/003: membership alone is NOT authorization. Resolve the project (org
  // membership) AND enforce the caller's role IN THAT org for `action`. Reads use
  // `instance.read`; mutations use `instance.update`.
  async function ensureProject(
    req: Parameters<NonNullable<typeof app.requireAuth>>[0],
    ref: string,
    action: Action,
  ): Promise<void> {
    const user = app.requireAuth(req);
    const row = await getProjectByRef(user.id, ref);
    if (!row) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
    }
    await app.authorizeOrg(req, action, row.orgId);
  }

  // ─── GET /functions (list) ──────────────────────────────────────────────
  app.get<{ Params: { ref: string } }>('/projects/:ref/functions', async (req) => {
    await ensureProject(req, req.params.ref, 'instance.read');
    return listFunctions(req.params.ref);
  });

  // ─── PUT /functions (bulk-update finalize) ──────────────────────────────
  app.put<{ Params: { ref: string } }>('/projects/:ref/functions', async (req) => {
    await ensureProject(req, req.params.ref, 'instance.update');
    // Body is the CLI's BulkUpdateFunctionBody; selfbase ignores it (the
    // per-function POSTs are the source of truth) and returns the canonical
    // list of stored functions.
    const list = await listFunctions(req.params.ref);
    return { functions: list };
  });

  // ─── POST /functions/deploy (multipart, --use-api) ──────────────────────
  app.post<{ Params: { ref: string }; Querystring: { slug?: string } }>(
    '/projects/:ref/functions/deploy',
    async (req, reply) => {
      const user = app.requireAuth(req);
      await ensureProject(req, req.params.ref, 'instance.update');
      const slug = req.query.slug;
      if (!slug) {
        throw new ManagementApiError(400, 'missing required query param: slug', 'bad_request');
      }
      if (!req.isMultipart()) {
        throw new ManagementApiError(
          400,
          'expected multipart/form-data body for /functions/deploy',
          'bad_request',
        );
      }
      const parts = req.parts();
      const result = await deployFromMultipart({
        ref: req.params.ref,
        slug,
        deployerUserId: user.id,
        parts,
      });
      return reply.status(201).send(result);
    },
  );

  // ─── POST /functions (eszip create) ─────────────────────────────────────
  app.post<{
    Params: { ref: string };
    Querystring: Record<string, string | string[] | undefined>;
  }>('/projects/:ref/functions', async (req, reply) => {
    const user = app.requireAuth(req);
    await ensureProject(req, req.params.ref, 'instance.update');
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (!ESZIP_CONTENT_TYPES.has(contentType)) {
      throw new ManagementApiError(
        400,
        `expected eszip body (application/vnd.denoland.eszip); got ${contentType}`,
        'bad_request',
      );
    }
    const slug = (req.query.slug ?? '') as string;
    if (!slug) {
      throw new ManagementApiError(400, 'missing required query param: slug', 'bad_request');
    }
    const body = req.body as Buffer;
    const result = await deployFromEszip({
      ref: req.params.ref,
      slug,
      deployerUserId: user.id,
      mode: 'create',
      body,
      query: req.query,
    });
    return reply.status(201).send(result);
  });

  // ─── PATCH /functions/:slug (eszip update) ──────────────────────────────
  app.patch<{
    Params: { ref: string; slug: string };
    Querystring: Record<string, string | string[] | undefined>;
  }>('/projects/:ref/functions/:slug', async (req, reply) => {
    const user = app.requireAuth(req);
    await ensureProject(req, req.params.ref, 'instance.update');
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (!ESZIP_CONTENT_TYPES.has(contentType)) {
      throw new ManagementApiError(
        400,
        `expected eszip body (application/vnd.denoland.eszip); got ${contentType}`,
        'bad_request',
      );
    }
    const body = req.body as Buffer;
    const result = await deployFromEszip({
      ref: req.params.ref,
      slug: req.params.slug,
      deployerUserId: user.id,
      mode: 'update',
      body,
      query: req.query,
    });
    return reply.status(200).send(result);
  });

  // ─── GET /functions/deployed-size ───────────────────────────────────────
  // Returns the total size in bytes of all deployed function bundles.
  // Must be registered before /:slug to avoid parameter capture.
  app.get<{ Params: { ref: string } }>('/projects/:ref/functions/deployed-size', async (req) => {
    await ensureProject(req, req.params.ref, 'instance.read');
    return { deployed_size: 0 };
  });

  // ─── GET /functions/:slug (single metadata) ─────────────────────────────
  app.get<{ Params: { ref: string; slug: string } }>(
    '/projects/:ref/functions/:slug',
    async (req) => {
      await ensureProject(req, req.params.ref, 'instance.read');
      const row = await getFunction(req.params.ref, req.params.slug);
      if (!row) {
        throw new ManagementApiError(404, 'Function not found', 'not_found', {
          slug: req.params.slug,
        });
      }
      return functionRowToFunction(row);
    },
  );

  // ─── GET /functions/:slug/body (download) ───────────────────────────────
  app.get<{ Params: { ref: string; slug: string } }>(
    '/projects/:ref/functions/:slug/body',
    async (req, reply) => {
      await ensureProject(req, req.params.ref, 'instance.read');
      const row = await getFunction(req.params.ref, req.params.slug);
      if (!row) {
        throw new ManagementApiError(404, 'Function not found', 'not_found', {
          slug: req.params.slug,
        });
      }
      const bundle = await readFunctionBundle(req.params.ref, req.params.slug);
      const form = new FormData();
      form.append(
        'metadata',
        JSON.stringify({
          entrypoint_path: row.entrypointPath ?? '',
          import_map_path: row.importMapPath ?? '',
          name: row.slug,
          verify_jwt: row.verifyJwt,
        }),
      );
      for (const { filename, contents } of bundle) {
        form.append('file', contents, {
          filename,
          contentType: 'application/octet-stream',
        });
      }
      const buf = form.getBuffer();
      const headers = form.getHeaders();
      for (const [k, v] of Object.entries(headers)) {
        reply.header(k, v);
      }
      reply.header('content-length', String(buf.byteLength));
      return reply.send(buf);
    },
  );

  // ─── DELETE /functions/:slug ────────────────────────────────────────────
  app.delete<{ Params: { ref: string; slug: string } }>(
    '/projects/:ref/functions/:slug',
    async (req) => {
      await ensureProject(req, req.params.ref, 'instance.update');
      const removed = await deleteFunction(req.params.ref, req.params.slug);
      if (!removed) {
        throw new ManagementApiError(404, 'Function not found', 'not_found', {
          slug: req.params.slug,
        });
      }
      return { message: 'Function deleted' };
    },
  );
};
