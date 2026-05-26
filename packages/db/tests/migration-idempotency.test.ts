/**
 * T054 — every migration SQL file in packages/db/migrations/ must be
 * idempotent. Run each twice; the second pass must complete without
 * errors and produce an identical schema.
 *
 * Skips when TEST_DATABASE_URL is not set, like the other DB-touching
 * tests in this monorepo.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('migration idempotency', () => {
  it('every *.sql file in migrations/ runs cleanly twice', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThan(0);

    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS citext');
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

      for (const file of files) {
        const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
        // First pass.
        await client.query(sql);
        // Snapshot schema.
        const schemaBefore = await snapshotSchema(client);
        // Second pass — must be a no-op.
        await client.query(sql);
        const schemaAfter = await snapshotSchema(client);
        expect(schemaAfter, `${file} not idempotent`).toEqual(schemaBefore);
      }
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('full migration sequence run twice produces zero schema diff (SC-005)', async () => {
    // T050: end-to-end — apply EVERY migration in order, snapshot, apply them
    // ALL again as a single sequence, snapshot. The two snapshots must match.
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThan(0);

    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS citext');
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

      const apply = async () => {
        for (const file of files) {
          const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
          await client.query(sql);
        }
      };

      await apply();
      const snapshotA = await snapshotSchema(client);
      await apply();
      const snapshotB = await snapshotSchema(client);
      expect(snapshotB).toEqual(snapshotA);
    } finally {
      client.release();
      await pool.end();
    }
  });

  it('migrate() runner is itself idempotent across two full invocations', async () => {
    // Exercises packages/db/src/migrate.ts (real entrypoint used at API/worker
    // startup) — second call must complete without errors and leave the same
    // schema.
    const { migrate } = await import('../src/migrate.js');
    await migrate(TEST_DATABASE_URL!);

    const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    const client = await pool.connect();
    let before: unknown;
    try {
      before = await snapshotSchema(client);
    } finally {
      client.release();
      await pool.end();
    }

    await migrate(TEST_DATABASE_URL!);

    const pool2 = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
    const client2 = await pool2.connect();
    try {
      const after = await snapshotSchema(client2);
      expect(after).toEqual(before);
    } finally {
      client2.release();
      await pool2.end();
    }
  });
});

/**
 * Compact representation of the public-schema state — table column names,
 * types, nullability, defaults — that two identical migration runs MUST
 * produce. Excludes index oids (they change between runs but the index
 * names are stable).
 */
async function snapshotSchema(client: pg.PoolClient): Promise<unknown> {
  const cols = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const idx = await client.query(`
    SELECT tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);
  return {
    columns: cols.rows,
    indexes: idx.rows,
  };
}
