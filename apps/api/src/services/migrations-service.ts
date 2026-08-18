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
  ALTER TABLE supabase_migrations.schema_migrations
    ADD COLUMN IF NOT EXISTS created_by text;
  ALTER TABLE supabase_migrations.schema_migrations
    ADD COLUMN IF NOT EXISTS idempotency_key text;
  CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_idempotency_key_key
    ON supabase_migrations.schema_migrations (idempotency_key);
`;

/** Every column upstream's V1GetMigrationResponse can carry. Kept as one
 *  constant so a new column cannot be added to the SELECT in one place and
 *  forgotten in the INSERT ... RETURNING in another. */
const DETAIL_COLUMNS = 'version, name, statements, rollback, created_by, idempotency_key';

export interface MigrationRow {
  version: string;
  name: string | null;
  statements: string[] | null;
}

/** What `GET /v1/projects/:ref/database/migrations/:version` answers with —
 *  upstream's V1GetMigrationResponse. `created_by` and `idempotency_key` are
 *  optional there; rows written before this table grew those columns, or by the
 *  CLI directly, carry null rather than a fabricated value. */
export interface MigrationDetail extends MigrationRow {
  rollback: string[] | null;
  created_by: string | null;
  idempotency_key: string | null;
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
      `SELECT ${DETAIL_COLUMNS}
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
        RETURNING ${DETAIL_COLUMNS}`,
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

/**
 * Version stamp upstream's PUT derives on the caller's behalf: UTC
 * `YYYYMMDDHHMMSS`, the same 14-digit shape the CLI generates for a migration
 * filename and the same one `VERSION_REGEX` enforces everywhere else.
 *
 * Exported so the derivation is testable without a database — it is the one
 * piece of the PUT that is a decision rather than a query.
 */
export function versionFromDate(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/** Two PUTs inside the same UTC second would derive the same version and the
 *  second would silently lose to the primary key. We walk the stamp forward a
 *  second at a time instead; more than this many collisions in a row is a
 *  clock problem, not contention. */
const VERSION_COLLISION_RETRIES = 5;

export class MigrationVersionCollisionError extends Error {
  code = 'migration_version_collision' as const;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

/**
 * `PUT /v1/projects/:ref/database/migrations` — upstream's
 * `v1-upsert-a-migration`: record a migration in the history table WITHOUT
 * executing it. Summary is literally "Upsert a database migration without
 * applying", so nothing here touches the schema it describes.
 *
 * Differences from our older `POST …/migrations/upsert`, which stays for the
 * callers that already use it: upstream takes an opaque `{query}` and derives
 * the version itself, where the POST takes an explicit `{version, statements[]}`.
 * Both write the same row.
 *
 * `query` is stored as a single-element `statements[]` for the same reason
 * `rollback` is: splitting SQL into statements needs a real parser, and a naive
 * split on ';' corrupts any function body or string literal containing one.
 *
 * `Idempotency-Key` is upstream's header for "ensure the same migration is
 * tracked only once" — a repeat call with a key already in the table returns
 * the row that key wrote rather than stamping a second one.
 */
export async function putMigration(
  ref: string,
  input: {
    query: string;
    name?: string | null;
    rollback?: string | null;
    idempotencyKey?: string | null;
    createdBy?: string | null;
    /** Injectable clock — the derivation is time-based and tests need it fixed. */
    now?: Date;
  },
): Promise<MigrationDetail> {
  return withPerInstancePg(ref, async (client) => {
    await client.query(LAZY_BOOTSTRAP);

    const findByKey = async (key: string): Promise<MigrationDetail | null> => {
      const { rows } = await client.query<MigrationDetail>(
        `SELECT ${DETAIL_COLUMNS}
           FROM supabase_migrations.schema_migrations
          WHERE idempotency_key = $1`,
        [key],
      );
      return rows[0] ?? null;
    };

    if (input.idempotencyKey) {
      const existing = await findByKey(input.idempotencyKey);
      if (existing) return existing;
    }

    let stamp = input.now ?? new Date();
    for (let attempt = 0; attempt < VERSION_COLLISION_RETRIES; attempt++) {
      const version = versionFromDate(stamp);
      try {
        const { rows } = await client.query<MigrationDetail>(
          `INSERT INTO supabase_migrations.schema_migrations
             (version, name, statements, rollback, created_by, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (version) DO NOTHING
           RETURNING ${DETAIL_COLUMNS}`,
          [
            version,
            input.name ?? null,
            [input.query],
            input.rollback === null || input.rollback === undefined ? null : [input.rollback],
            input.createdBy ?? null,
            input.idempotencyKey ?? null,
          ],
        );
        if (rows[0]) return rows[0];
      } catch (err) {
        // Another request with the same Idempotency-Key won the race between
        // our lookup above and this insert. Its row is the answer.
        if (isUniqueViolation(err) && input.idempotencyKey) {
          const raced = await findByKey(input.idempotencyKey);
          if (raced) return raced;
        }
        throw err;
      }
      stamp = new Date(stamp.getTime() + 1000);
    }
    throw new MigrationVersionCollisionError(
      `could not derive a free migration version after ${VERSION_COLLISION_RETRIES} attempts`,
    );
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
