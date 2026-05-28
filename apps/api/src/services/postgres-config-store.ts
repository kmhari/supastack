/**
 * Postgres config store — GET/PUT /v1/projects/:ref/config/database/postgres.
 *
 * GET: reads current live values from per-instance pg_settings.
 * PUT: applies changes via ALTER SYSTEM SET + pg_reload_conf(); optionally
 *      restarts the postgres container when restart_database=true or when
 *      any postmaster-context parameter was changed.
 *
 * Persistence: project_config_snapshots with surface='postgres'. This is
 * the source of truth for GET when the instance is paused/unreachable — we
 * fall back to the snapshot if pg is not connectable.
 *
 * Feature 026 — supabase config push compat.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { encryptJson, decryptJson, loadMasterKey } from '@selfbase/crypto';
import {
  UpdatePostgresConfigBodySchema,
  POSTGRES_INTEGER_FIELDS,
  POSTGRES_BOOLEAN_FIELDS,
  POSTGRES_CONFIG_PARAM_NAMES,
  type PostgresConfigResponse,
  type UpdatePostgresConfigBody,
} from '@selfbase/shared';
import { ZodError } from 'zod';
import { ManagementApiError } from '../plugins/mgmt-api-errors.js';
import {
  withPerInstancePg,
  InstanceNotFoundError,
  InstanceNotRunningError,
} from './per-instance-pg.js';
import { getDockerControl } from './docker-control-adapter.js';
import { withProjectConfigLock } from './runtime-config-store.js';

export type PostgresConfigSource = { userId: string };

// pg_settings context values that require a full postgres restart
const POSTMASTER_CONTEXT = new Set(['postmaster', 'internal']);

// ─── Public API ────────────────────────────────────────────────────────────

export async function getPostgresConfig(ref: string): Promise<PostgresConfigResponse> {
  try {
    return await withPerInstancePg(ref, readLiveConfig, { timeoutMs: 5000 });
  } catch (err) {
    if (err instanceof InstanceNotRunningError) {
      // Fall back to snapshot when project is paused
      return loadSnapshot(ref);
    }
    throw wrapPgError(err);
  }
}

export async function putPostgresConfig(
  ref: string,
  body: unknown,
  source: PostgresConfigSource,
): Promise<PostgresConfigResponse> {
  let parsed: UpdatePostgresConfigBody;
  try {
    parsed = UpdatePostgresConfigBodySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      const details: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_root';
        details[key] = issue.message;
        if (issue.code === 'unrecognized_keys') {
          for (const k of issue.keys) details[k] = 'unknown_field';
        }
      }
      throw new ManagementApiError(400, 'Validation failed', 'validation_failed', details);
    }
    throw err;
  }

  const { restart_database, ...params } = parsed;
  const paramEntries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null) as [
    string,
    string | number | boolean,
  ][];

  if (paramEntries.length === 0) {
    return getPostgresConfig(ref);
  }

  return withProjectConfigLock(ref, async () => {
    try {
      return await withPerInstancePg(
        ref,
        async (client) => {
          // Get the context for each param being changed
          const names = paramEntries.map(([k]) => k);
          const { rows: contextRows } = await client.query<{ name: string; context: string }>(
            `SELECT name, context FROM pg_settings WHERE name = ANY($1)`,
            [names],
          );
          const contextMap = new Map(contextRows.map((r) => [r.name, r.context]));

          // Validate all names are known pg params
          for (const [name] of paramEntries) {
            if (!contextMap.has(name)) {
              throw new ManagementApiError(400, 'Validation failed', 'validation_failed', {
                [name]: `unknown postgres parameter`,
              });
            }
          }

          // Apply each via ALTER SYSTEM SET
          for (const [name, value] of paramEntries) {
            const literal = toPostgresLiteral(name, value);
            await client.query(`ALTER SYSTEM SET ${name} = ${literal}`);
          }

          // Reload — applies sighup + user-context params immediately
          await client.query('SELECT pg_reload_conf()');

          // Check if any postmaster-context params were changed
          const needsRestart = paramEntries.some(([name]) => {
            const ctx = contextMap.get(name);
            return ctx !== undefined && POSTMASTER_CONTEXT.has(ctx);
          });

          if (needsRestart || restart_database) {
            const docker = getDockerControl();
            const container = `selfbase-${ref}-db-1`;
            try {
              await docker.restart(container);
              await docker.waitHealthy(container, 30000);
            } catch (err) {
              throw new ManagementApiError(
                500,
                `Postgres config applied but container ${container} failed to restart.`,
                'restart_failed',
                { container, cause: (err as Error).message },
              );
            }
          }

          const live = await readLiveConfig(client);
          await persistSnapshot(ref, live, source.userId);
          return live;
        },
        { timeoutMs: 30000 },
      );
    } catch (err) {
      if (err instanceof ManagementApiError) throw err;
      throw wrapPgError(err);
    }
  });
}

// ─── Internals ─────────────────────────────────────────────────────────────

async function readLiveConfig(client: import('pg').Client): Promise<PostgresConfigResponse> {
  const { rows } = await client.query<{ name: string; setting: string }>(
    `SELECT name, setting FROM pg_settings WHERE name = ANY($1)`,
    [[...POSTGRES_CONFIG_PARAM_NAMES]],
  );

  const out: Record<string, unknown> = {};
  for (const { name, setting } of rows) {
    if (POSTGRES_INTEGER_FIELDS.has(name)) {
      out[name] = parseInt(setting, 10);
    } else if (POSTGRES_BOOLEAN_FIELDS.has(name)) {
      out[name] = setting === 'on' || setting === 'true';
    } else {
      out[name] = setting;
    }
  }
  return out as PostgresConfigResponse;
}

async function loadSnapshot(ref: string): Promise<PostgresConfigResponse> {
  const row = await db()
    .select({ payload: schema.projectConfigSnapshots.encryptedPayload })
    .from(schema.projectConfigSnapshots)
    .where(
      and(
        eq(schema.projectConfigSnapshots.instanceRef, ref),
        eq(schema.projectConfigSnapshots.surface, 'postgres'),
      ),
    )
    .limit(1);
  if (row[0]) {
    return decryptJson<PostgresConfigResponse>(row[0].payload, loadMasterKey());
  }
  return {};
}

async function persistSnapshot(
  ref: string,
  config: PostgresConfigResponse,
  userId: string,
): Promise<void> {
  const encrypted = encryptJson(config, loadMasterKey());
  const existing = await db()
    .select({ id: schema.projectConfigSnapshots.id })
    .from(schema.projectConfigSnapshots)
    .where(
      and(
        eq(schema.projectConfigSnapshots.instanceRef, ref),
        eq(schema.projectConfigSnapshots.surface, 'postgres'),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db()
      .update(schema.projectConfigSnapshots)
      .set({ encryptedPayload: encrypted, updatedAt: new Date(), updatedBy: userId })
      .where(eq(schema.projectConfigSnapshots.id, existing[0].id));
  } else {
    await db().insert(schema.projectConfigSnapshots).values({
      instanceRef: ref,
      surface: 'postgres',
      encryptedPayload: encrypted,
      updatedBy: userId,
    });
  }
}

function toPostgresLiteral(name: string, value: string | number | boolean): string {
  if (POSTGRES_INTEGER_FIELDS.has(name)) {
    return String(Number(value));
  }
  if (POSTGRES_BOOLEAN_FIELDS.has(name)) {
    return value ? "'on'" : "'off'";
  }
  // String — escape single quotes by doubling them (standard SQL)
  const str = String(value).replace(/'/g, "''");
  return `'${str}'`;
}

function wrapPgError(err: unknown): ManagementApiError {
  if (err instanceof InstanceNotFoundError) {
    return new ManagementApiError(404, 'Project not found', 'not_found', {});
  }
  if (err instanceof InstanceNotRunningError) {
    return new ManagementApiError(503, `Project is not running: ${err.status}`, 'not_running', {
      status: err.status,
    });
  }
  const msg = (err as Error).message ?? 'Unknown error';
  return new ManagementApiError(500, `Postgres config error: ${msg}`, 'internal_error', {});
}
