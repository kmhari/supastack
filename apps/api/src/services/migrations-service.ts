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
`;

export interface MigrationRow {
  version: string;
  name: string | null;
  statements: string[] | null;
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
