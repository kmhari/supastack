import { withPerInstancePg } from './per-instance-pg.js';

/**
 * Migration history service — powers `supabase migration list/repair/fetch`
 * (feature 006 US2). Reads + upserts + deletes rows in
 * `supabase_migrations.schema_migrations` on the per-project Postgres.
 *
 * The first statement of every operation is the idempotent lazy bootstrap
 * (research.md Decision 3) so projects whose Postgres was provisioned
 * before the `supabase_migrations` schema existed still work.
 */

const LAZY_BOOTSTRAP = `
  CREATE SCHEMA IF NOT EXISTS supabase_migrations;
  CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text PRIMARY KEY,
    name text,
    statements text[]
  );
  ALTER TABLE supabase_migrations.schema_migrations
    ADD COLUMN IF NOT EXISTS rollback text[];
`;

export interface MigrationRow {
  version: string;
  name: string | null;
  statements: string[] | null;
}

/** What `GET /v1/projects/:ref/database/migrations/:version` answers with —
 *  upstream's V1GetMigrationResponse. `created_by` and `idempotency_key` are
 *  optional there and we have no source for either, so they stay absent rather
 *  than being invented. */
export interface MigrationDetail extends MigrationRow {
  rollback: string[] | null;
}

export const VERSION_REGEX = /^\d{14}$/;

export async function listMigrations(ref: string): Promise<MigrationRow[]> {
  return withPerInstancePg(ref, async (client) => {
    await client.query(LAZY_BOOTSTRAP);
    const { rows } = await client.query<MigrationRow>(
      `SELECT version, name, statements
         FROM supabase_migrations.schema_migrations
        ORDER BY version ASC`,
    );
    return rows;
  });
}

export async function upsertMigration(
  ref: string,
  row: { version: string; name?: string | null; statements?: string[] | null },
): Promise<MigrationRow> {
  return withPerInstancePg(ref, async (client) => {
    await client.query(LAZY_BOOTSTRAP);
    const { rows } = await client.query<MigrationRow>(
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO UPDATE
         SET name       = COALESCE(EXCLUDED.name, supabase_migrations.schema_migrations.name),
             statements = COALESCE(EXCLUDED.statements, supabase_migrations.schema_migrations.statements)
       RETURNING version, name, statements`,
      [row.version, row.name ?? null, row.statements ?? null],
    );
    return rows[0]!;
  });
}

/** Single migration by version. `null` = no such row (the caller turns that into
 *  a 404; an empty object would read as "exists but blank"). */
export async function getMigration(ref: string, version: string): Promise<MigrationDetail | null> {
  return withPerInstancePg(ref, async (client) => {
    await client.query(LAZY_BOOTSTRAP);
    const { rows } = await client.query<MigrationDetail>(
      `SELECT version, name, statements, rollback
         FROM supabase_migrations.schema_migrations
        WHERE version = $1`,
      [version],
    );
    return rows[0] ?? null;
  });
}

/**
 * Partial update of an existing migration's metadata (upstream's
 * V1PatchMigrationBody = {name?, rollback?}).
 *
 * Absent keys must not be clobbered, so each field is guarded by its own
 * `$n::bool` flag rather than COALESCE — COALESCE cannot distinguish "field
 * omitted" from "field explicitly set to null", and PATCH has to.
 *
 * `rollback` arrives as one SQL string and is stored as a single-element text[]:
 * upstream's GET returns an array, and splitting the script into statements
 * would need a real SQL parser — a naive split on ';' corrupts any function body
 * or string literal containing one.
 */
export async function patchMigration(
  ref: string,
  version: string,
  patch: { name?: string | null; rollback?: string | null },
): Promise<MigrationDetail | null> {
  return withPerInstancePg(ref, async (client) => {
    await client.query(LAZY_BOOTSTRAP);
    const hasName = Object.prototype.hasOwnProperty.call(patch, 'name');
    const hasRollback = Object.prototype.hasOwnProperty.call(patch, 'rollback');
    const { rows } = await client.query<MigrationDetail>(
      `UPDATE supabase_migrations.schema_migrations
          SET name     = CASE WHEN $2::bool THEN $3::text   ELSE name     END,
              rollback = CASE WHEN $4::bool THEN $5::text[] ELSE rollback END
        WHERE version = $1
        RETURNING version, name, statements, rollback`,
      [
        version,
        hasName,
        patch.name ?? null,
        hasRollback,
        patch.rollback === null || patch.rollback === undefined ? null : [patch.rollback],
      ],
    );
    return rows[0] ?? null;
  });
}

export async function deleteMigration(
  ref: string,
  version: string,
): Promise<{ version: string; deleted: boolean }> {
  return withPerInstancePg(ref, async (client) => {
    await client.query(LAZY_BOOTSTRAP);
    const { rowCount } = await client.query(
      `DELETE FROM supabase_migrations.schema_migrations WHERE version = $1`,
      [version],
    );
    return { version, deleted: (rowCount ?? 0) > 0 };
  });
}
