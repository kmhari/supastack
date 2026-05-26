/**
 * CLI login-role endpoints (feature 012).
 *
 * Mounted inside the `/v1/*` Fastify scope at apps/api/src/server.ts so it
 * inherits the cloud-compatible `{ message, code?, details? }` error envelope
 * via `mgmt-api-errors`.
 *
 * Wire contract is dictated by the upstream `supabase` CLI binary:
 *   - POST   /v1/projects/{ref}/cli/login-role  → 201 { role, password, ttl_seconds }
 *   - DELETE /v1/projects/{ref}/cli/login-role  → 200 { message: "ok" }
 *
 * Both methods share the same path; the OpenAPI operationId is plural
 * (`v1-delete-login-roles`) but the URL is singular. Verified against
 * api.supabase.com/api/v1-json (pinned snapshot:
 * specs/012-cli-login-role/contracts/upstream-openapi-snapshot.json).
 *
 * Auth: existing PAT bearer scheme (`/v1/*` scope).
 * RBAC: `database.create-login-role` action, admin-only (research.md
 *       Decision 10). Both methods gate on the same action — being able to
 *       invalidate is strictly less dangerous than being able to mint.
 * Rate limit (POST only): 30/min/PAT/project (spec Clarifications Q3,
 *                          spec FR-010). Returns 429 + Retry-After header
 *                          when exceeded.
 * Audit: every successful rotation/invalidation emits a structured pino log
 *        line (`event: cli_login_role_{rotated,invalidated}`).
 */
import type { FastifyPluginAsync } from 'fastify';
import { CreateLoginRoleBody } from '@selfbase/shared';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import {
  invalidateCliLoginRoles,
  rotateCliLoginRole,
} from '../../services/cli-login-role-service.js';
import {
  RATE_LIMIT,
  WINDOW_MS,
  tryConsume,
} from '../../services/cli-login-role-bucket.js';
import {
  InstanceNotFoundError,
  InstanceNotRunningError,
  PerInstancePgConnectError,
} from '../../services/per-instance-pg.js';
import { getProjectByRef } from '../../services/project-store.js';

function mapPgError(err: unknown): never {
  if (err instanceof InstanceNotFoundError) {
    throw new ManagementApiError(404, err.message, 'not_found');
  }
  if (err instanceof InstanceNotRunningError) {
    throw new ManagementApiError(409, err.message, 'project_not_running', {
      status: err.status,
    });
  }
  if (err instanceof PerInstancePgConnectError) {
    throw new ManagementApiError(502, err.message, 'per_instance_pg_connect_error');
  }
  throw err;
}

export const cliLoginRoleRoutes: FastifyPluginAsync = async (app) => {
  // ─── POST: rotate password, return fresh creds ───────────────────────────
  app.post<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/cli/login-role',
    async (req, reply) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'database.create-login-role');

      // Project visibility check FIRST (mirrors migrations.ts and the
      // existing convention). A PAT that can't see this project gets a
      // 404 byte-identical to "project doesn't exist" — avoids enumeration.
      const ref = req.params.ref;
      const proj = await getProjectByRef(user.id, ref);
      if (!proj) {
        throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
      }

      // Body validation.
      const parsed = CreateLoginRoleBody.safeParse(req.body);
      if (!parsed.success) {
        throw new ManagementApiError(
          422,
          parsed.error.issues[0]?.message ?? 'invalid request body',
          'invalid_request',
          { issues: parsed.error.issues },
        );
      }

      // Read-only scope is currently not implemented in selfbase. The
      // upstream CLI's `initLoginRole` hardcodes `ReadOnly: false` so this
      // path is not exercised by any normal `supabase` CLI invocation — but
      // the wire surface accepts it for hypothetical non-CLI clients.
      //
      // Two structural blockers prevent a clean implementation right now:
      //   1. Postgres' `supautils` extension reserves membership in
      //      `supabase_read_only_user` — only the true superuser
      //      (`supabase_admin`) can grant it, and the api container
      //      connects as `postgres`, not `supabase_admin`.
      //   2. The CLI's AfterConnect callback (connect.go:215-220)
      //      hardcodes `SET SESSION ROLE postgres` whenever the username
      //      starts with `cli_login_`, regardless of scope. An RO login
      //      role that ends up running `SET SESSION ROLE postgres` is
      //      effectively read-write anyway — defeats the purpose.
      //
      // The honest fix involves either (a) the api container connecting
      // as `supabase_admin` for this specific operation (requires an
      // additional secret per instance + a per-call connection swap), or
      // (b) a CLI fork that respects the response scope. Tracked as
      // follow-up; see docs/changes/012-cli-login-role.md for the
      // rationale.
      if (parsed.data.read_only) {
        throw new ManagementApiError(
          501,
          'read_only=true is not yet implemented in selfbase; see docs/changes/012-cli-login-role.md',
          'not_implemented',
          { reason: 'read_only_scope_reserved_by_supautils' },
        );
      }

      // Rate-limit. Key on PAT (or fall back to user id for session-cookie
      // callers — typically the dashboard, which doesn't use this endpoint).
      const limiterKey = `${user.tokenId ?? user.id}:${ref}`;
      const result = tryConsume(limiterKey, RATE_LIMIT, WINDOW_MS);
      if (!result.allowed) {
        reply.header('Retry-After', String(result.retryAfterSeconds));
        throw new ManagementApiError(429, 'rate limit exceeded', 'rate_limited', {
          retry_after_seconds: result.retryAfterSeconds,
        });
      }

      // Rotate. Maps per-instance-pg errors to the same shapes
      // migrations.ts uses (404/409/502).
      try {
        const out = await rotateCliLoginRole(ref, {
          readOnly: parsed.data.read_only,
          patId: user.tokenId ?? user.id,
          requesterIp: req.ip,
          logger: req.log,
        });
        return reply.status(201).send({
          role: out.role,
          password: out.password,
          ttl_seconds: out.ttlSeconds,
        });
      } catch (err) {
        mapPgError(err);
      }
    },
  );

  // ─── DELETE: invalidate active passwords on both CLI roles ────────────────
  app.delete<{ Params: { ref: string } }>(
    '/projects/:ref/cli/login-role',
    async (req, reply) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'database.create-login-role');

      const ref = req.params.ref;
      const proj = await getProjectByRef(user.id, ref);
      if (!proj) {
        throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
      }

      // DELETE does NOT consume the rate-limit bucket (spec Q3, FR-010 —
      // the bucket gates the create endpoint only, so lockdown is always
      // available even from a PAT that has hit its rotation cap).
      try {
        await invalidateCliLoginRoles(ref, {
          patId: user.tokenId ?? user.id,
          requesterIp: req.ip,
          logger: req.log,
        });
        return reply.status(200).send({ message: 'ok' });
      } catch (err) {
        mapPgError(err);
      }
    },
  );
};
