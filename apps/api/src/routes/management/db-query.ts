/**
 * POST /v1/projects/:ref/database/query — feature 013 US1.
 *
 * Wire shape MUST match upstream `V1RunQueryBody` byte-for-byte. Verified
 * against https://api.supabase.com/api/v1-json. Any drift breaks the
 * unmodified upstream Supabase CLI + MCP server (SC-007).
 *
 * Audit: emits an audit_log row on EVERY terminating path (success or any
 * failure mode) per the audit-coverage requirement (data-model.md +
 * tasks.md T010). Uses a try/finally-shaped helper internal to this file.
 *
 * Statement timeout: NOT request-overridable. Pass `timeoutMs: null` to
 * `withPerInstancePg` so the client doesn't override the per-project
 * Postgres `statement_timeout` GUC — matches Cloud (FR-007).
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { DbQueryBodySchema, type DbQueryBody } from '@supastack/shared';
import { db, schema } from '@supastack/db';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { detectMultiStatement } from '../../services/multi-statement-detect.js';
import {
  withPerInstancePg,
  InstanceNotFoundError,
  InstanceNotRunningError,
  PerInstancePgConnectError,
} from '../../services/per-instance-pg.js';
import { getProjectByRef } from '../../services/project-store.js';

const PARAM_TRUNCATE_BYTES = 256;

type AuditOutcome =
  | { kind: 'success'; rowCount: number; durationMs: number }
  | { kind: 'failure'; errorCode: string; errorMessage: string; durationMs: number };

export const dbQueryRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/database/query',
    async (req, reply) => {
      const ref = req.params.ref;
      const startedAt = Date.now();

      // We capture body up-front (best-effort — may not pass Zod) so we can
      // audit-log it even on early failures.
      const rawBody = req.body as Record<string, unknown> | undefined;
      const auditSqlText = typeof rawBody?.query === 'string' ? rawBody.query : '';
      const auditParameters = Array.isArray(rawBody?.parameters)
        ? truncateParameters(rawBody.parameters as unknown[])
        : undefined;
      const auditReadOnly = typeof rawBody?.read_only === 'boolean' ? rawBody.read_only : undefined;

      // Track user info for audit so failures (including 401/403) still emit.
      // requireAuth throws AppError on missing auth — that propagates to the
      // global error handler. Since the user isn't resolved at that point,
      // we can't audit anonymous 401 attempts (consistent with other routes).
      const user = app.requireAuth(req);

      const emit = (outcome: AuditOutcome): void => {
        void emitAudit(user.id, ref, {
          query: auditSqlText,
          parameters: auditParameters,
          read_only: auditReadOnly,
          outcome,
        }).catch((err) => req.log.warn({ err, ref }, 'db-query audit emit failed'));
      };

      // ─── Project visibility (resolve org before RBAC — SEC-002) ──────────
      const proj = await getProjectByRef(user.id, ref);
      if (!proj) {
        emit({
          kind: 'failure',
          errorCode: 'not_found',
          errorMessage: 'project not found',
          durationMs: Date.now() - startedAt,
        });
        throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
      }

      // ─── RBAC (org-scoped) ───────────────────────────────────────────────
      try {
        await app.authorizeOrg(req, 'database.write', proj.orgId);
      } catch (err) {
        emit({
          kind: 'failure',
          errorCode: 'forbidden',
          errorMessage: 'admin role required',
          durationMs: Date.now() - startedAt,
        });
        throw err;
      }

      // ─── Body validation ────────────────────────────────────────────────
      const parsed = DbQueryBodySchema.safeParse(req.body);
      if (!parsed.success) {
        emit({
          kind: 'failure',
          errorCode: 'invalid_params',
          errorMessage: parsed.error.issues[0]?.message ?? 'invalid request body',
          durationMs: Date.now() - startedAt,
        });
        throw new ManagementApiError(
          400,
          parsed.error.issues[0]?.message ?? 'invalid request body',
          'invalid_params',
          { issues: parsed.error.issues },
        );
      }
      const body: DbQueryBody = parsed.data;

      // ─── Multi-statement reject ─────────────────────────────────────────
      if (detectMultiStatement(body.query)) {
        emit({
          kind: 'failure',
          errorCode: 'multi_statement_not_supported',
          errorMessage: 'multi-statement queries are not supported',
          durationMs: Date.now() - startedAt,
        });
        throw new ManagementApiError(
          400,
          'Multi-statement queries are not supported. Submit one statement at a time, or wrap multiple statements in a function.',
          'multi_statement_not_supported',
        );
      }

      // ─── Execute ────────────────────────────────────────────────────────
      try {
        const rows = await withPerInstancePg(
          ref,
          async (client) => {
            const res = await client.query<Record<string, unknown>>(
              body.query,
              body.parameters as unknown[] | undefined,
            );
            return res.rows;
          },
          { readOnly: body.read_only === true, timeoutMs: null },
        );

        const durationMs = Date.now() - startedAt;
        emit({ kind: 'success', rowCount: rows.length, durationMs });
        // Wire shape: bare array — matches upstream Supabase. The upstream
        // OpenAPI's 201 response is undocumented, but the upstream MCP server's
        // `list_tables` tool (chunk-IO3RHCXN.js) calls `.map()` directly on
        // `c.data`, proving the cloud returns `[...rows]`, not `{ result: [...] }`.
        // Discovered during SC-007 live MCP smoke (2026-05-26).
        return reply.status(201).send(rows);
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        // Map per-instance-pg errors first.
        if (err instanceof InstanceNotFoundError) {
          emit({ kind: 'failure', errorCode: 'not_found', errorMessage: err.message, durationMs });
          throw new ManagementApiError(404, err.message, 'not_found', { ref });
        }
        if (err instanceof InstanceNotRunningError) {
          emit({
            kind: 'failure',
            errorCode: 'project_not_runnable',
            errorMessage: err.message,
            durationMs,
          });
          throw new ManagementApiError(409, err.message, 'project_not_runnable', {
            status: err.status,
          });
        }
        if (err instanceof PerInstancePgConnectError) {
          emit({
            kind: 'failure',
            errorCode: 'pg_connect_failed',
            errorMessage: err.message,
            durationMs,
          });
          throw new ManagementApiError(503, err.message, 'pg_connect_failed');
        }
        // PG protocol error from the operator's SQL. Has SQLSTATE in `.code`.
        const pgErr = err as {
          message?: string;
          code?: string;
          severity?: string;
          position?: string;
          hint?: string;
        };
        if (pgErr && typeof pgErr.code === 'string' && /^[0-9A-Z]{5}$/.test(pgErr.code)) {
          // 25006 = read_only_sql_transaction → surfaces read_only=true violation
          const isReadOnlyViolation = pgErr.code === '25006';
          const code = isReadOnlyViolation ? 'read_only_violation' : 'pg_error';
          const message = pgErr.message ?? 'postgres error';
          emit({ kind: 'failure', errorCode: code, errorMessage: message, durationMs });
          throw new ManagementApiError(400, message, code, {
            severity: pgErr.severity,
            code: pgErr.code,
            position: pgErr.position,
            hint: pgErr.hint,
          });
        }
        emit({
          kind: 'failure',
          errorCode: 'internal',
          errorMessage: (err as Error).message ?? 'unknown',
          durationMs,
        });
        throw err;
      }
    },
  );
};

function truncateParameters(params: unknown[]): unknown[] {
  return params.map((p) => {
    const s = typeof p === 'string' ? p : JSON.stringify(p);
    if (typeof s === 'string' && Buffer.byteLength(s) > PARAM_TRUNCATE_BYTES) {
      return { truncated: true, original_size: Buffer.byteLength(s) };
    }
    return p;
  });
}

interface AuditPayload {
  query: string;
  parameters?: unknown[];
  read_only?: boolean;
  outcome: AuditOutcome;
}

async function emitAudit(userId: string, ref: string, p: AuditPayload): Promise<void> {
  const action =
    p.outcome.kind === 'success' ? 'instance.db.query.executed' : 'instance.db.query.failed';
  const basePayload: Record<string, unknown> = {
    ref,
    query: p.query,
    duration_ms: p.outcome.durationMs,
  };
  if (p.parameters !== undefined) basePayload.parameters = p.parameters;
  if (p.read_only !== undefined) basePayload.read_only = p.read_only;
  if (p.outcome.kind === 'success') {
    basePayload.row_count = p.outcome.rowCount;
  } else {
    basePayload.error_code = p.outcome.errorCode;
    basePayload.error_message = p.outcome.errorMessage;
  }
  await db().insert(schema.auditLog).values({
    actorUserId: userId,
    action,
    targetKind: 'instance',
    targetId: ref,
    payload: basePayload,
  });
}

// Suppress unused-import warning in case ts-prune flags FastifyRequest later.
void (null as unknown as FastifyRequest);
