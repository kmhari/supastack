/**
 * POST /v1/projects/:ref/database/dump — feature 013 US2.
 *
 * Streams pg_dump output for the per-project Postgres. Default schemas = all
 * non-internal schemas (clarification Q2). `dry_run` returns a JSON summary.
 * On client disconnect, AbortSignal fires and pg-dump-exec kills the running
 * pg_dump inside the container (FR-017 — no zombies).
 */
import type { FastifyPluginAsync } from 'fastify';
import { Writable } from 'node:stream';
import { DbDumpBodySchema, type DbDumpBody } from '@selfbase/shared';
import { db, schema } from '@selfbase/db';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import {
  withPerInstancePg,
  InstanceNotFoundError,
  InstanceNotRunningError,
  PerInstancePgConnectError,
} from '../../services/per-instance-pg.js';
import {
  streamPgDump,
  PgDumpFailedError,
  DockerExecFailedError,
} from '../../services/pg-dump-exec.js';
import { getProjectByRef } from '../../services/project-store.js';

export const dbDumpRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/database/dump',
    async (req, reply) => {
      const ref = req.params.ref;
      const startedAt = Date.now();
      const user = app.requireAuth(req);
      app.authorize(req, 'database.write');

      const proj = await getProjectByRef(user.id, ref);
      if (!proj) {
        throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
      }

      const parsed = DbDumpBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ManagementApiError(
          400,
          parsed.error.issues[0]?.message ?? 'invalid request body',
          'invalid_params',
          { issues: parsed.error.issues },
        );
      }
      const body: DbDumpBody = parsed.data;

      // ─── Resolve default schemas if not provided ────────────────────────
      let schemas = body.schemas;
      if (!schemas || schemas.length === 0) {
        try {
          schemas = await withPerInstancePg(
            ref,
            async (client) => {
              const res = await client.query<{ nspname: string }>(
                `SELECT nspname FROM pg_namespace
                 WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
                   AND nspname != 'information_schema'
                 ORDER BY nspname`,
              );
              return res.rows.map((r) => r.nspname);
            },
            { timeoutMs: 5000 },
          );
        } catch (err) {
          mapPgError(err);
        }
      }

      // ─── AbortSignal wired to client disconnect ────────────────────────
      const abortController = new AbortController();
      const onAbort = (): void => abortController.abort();
      req.raw.on('aborted', onAbort);
      req.raw.on('close', () => {
        if (!req.raw.complete) abortController.abort();
      });

      try {
        // ─── dry_run path ────────────────────────────────────────────────
        if (body.dry_run === true) {
          let totalBytes = 0;
          const sink = new Writable({
            write(chunk: Buffer, _enc, cb) {
              totalBytes += chunk.length;
              cb();
            },
          });
          try {
            await streamPgDump(
              ref,
              { dataOnly: body.data_only, schemaOnly: body.schema_only, schemas },
              sink,
              abortController.signal,
            );
          } catch (err) {
            mapDumpError(err);
          }
          const duration = Date.now() - startedAt;
          void emitDumpAudit(user.id, ref, {
            data_only: body.data_only,
            schema_only: body.schema_only,
            schemas: schemas!,
            dry_run: true,
            bytes_streamed: totalBytes,
          }).catch((err) => req.log.warn({ err, ref }, 'db-dump audit emit failed'));
          return reply.status(201).send({
            dry_run: true,
            bytes_estimated: totalBytes,
            schemas_dumped: schemas,
            duration_ms: duration,
          });
        }

        // ─── Streaming path ──────────────────────────────────────────────
        reply.status(201);
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Cache-Control', 'no-store');
        reply.hijack(); // Take over the raw response — bypass Fastify serializer.
        const raw = reply.raw;
        raw.statusCode = 201;
        raw.setHeader('Content-Type', 'application/octet-stream');
        raw.setHeader('Cache-Control', 'no-store');
        raw.setHeader('Transfer-Encoding', 'chunked');

        let bytesStreamed = 0;
        const outStream = new Writable({
          write(chunk: Buffer, _enc, cb) {
            bytesStreamed += chunk.length;
            if (!raw.write(chunk)) {
              raw.once('drain', cb);
            } else {
              cb();
            }
          },
        });

        let result: { exitCode: number; aborted: boolean } | null = null;
        try {
          result = await streamPgDump(
            ref,
            { dataOnly: body.data_only, schemaOnly: body.schema_only, schemas },
            outStream,
            abortController.signal,
          );
        } catch (err) {
          // We've already started streaming — can't change status. Best we can
          // do is end the connection. Log + audit.
          req.log.error({ err, ref }, 'pg_dump failed mid-stream');
          if (!raw.writableEnded) raw.end();
          // No audit for failed dump mid-stream (matches data-model.md).
          return;
        }

        if (result.aborted) {
          // Client disconnect mid-stream. No audit row.
          if (!raw.writableEnded) raw.end();
          return;
        }

        if (!raw.writableEnded) raw.end();
        void emitDumpAudit(user.id, ref, {
          data_only: body.data_only,
          schema_only: body.schema_only,
          schemas: schemas!,
          dry_run: false,
          bytes_streamed: bytesStreamed,
        }).catch((err) => req.log.warn({ err, ref }, 'db-dump audit emit failed'));
        return;
      } finally {
        req.raw.removeListener('aborted', onAbort);
      }
    },
  );
};

function mapPgError(err: unknown): never {
  if (err instanceof InstanceNotFoundError) {
    throw new ManagementApiError(404, err.message, 'not_found');
  }
  if (err instanceof InstanceNotRunningError) {
    throw new ManagementApiError(409, err.message, 'project_not_runnable', { status: err.status });
  }
  if (err instanceof PerInstancePgConnectError) {
    throw new ManagementApiError(503, err.message, 'pg_connect_failed');
  }
  throw err;
}

function mapDumpError(err: unknown): never {
  if (err instanceof PgDumpFailedError) {
    throw new ManagementApiError(502, err.message, 'pg_dump_failed', {
      exit_code: err.exitCode,
      stderr: err.stderr.slice(0, 1024),
    });
  }
  if (err instanceof DockerExecFailedError) {
    throw new ManagementApiError(503, err.message, 'docker_exec_failed');
  }
  throw err;
}

interface DumpAuditPayload {
  data_only?: boolean;
  schema_only?: boolean;
  schemas: string[];
  dry_run: boolean;
  bytes_streamed: number;
}

async function emitDumpAudit(userId: string, ref: string, p: DumpAuditPayload): Promise<void> {
  await db()
    .insert(schema.auditLog)
    .values({
      actorUserId: userId,
      action: 'instance.db.dump',
      targetKind: 'instance',
      targetId: ref,
      payload: { ref, ...p },
    });
}
