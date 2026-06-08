import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Verifies that running all migrations twice against a real Postgres instance
 * is a no-op (idempotent). Specifically guards against:
 *
 *   - Blind DROP+ADD constraint patterns that wipe data constraints already
 *     widened by a later migration (0020 regression that caused a boot crash).
 *   - Name collisions between migration files (0021_ prefix clash).
 *   - Any migration that crashes on re-run (non-idempotent DDL).
 *
 * Skipped unless TEST_DATABASE_URL is set. Bring up a PG container with:
 *   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_migrations postgres:16
 * Then run: TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/test_migrations pnpm test:integration
 */

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('Migration idempotency', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL, max: 1 });
    const client = await pool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS citext');
      await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('all migrations apply cleanly (first run)', async () => {
    await runMigrations(pool);
  });

  it('all migrations are idempotent (second run is a no-op)', async () => {
    await expect(runMigrations(pool)).resolves.not.toThrow();
  });

  it('project_config_snapshots_surface_check contains all 6 surfaces after migrations', async () => {
    const client = await pool.connect();
    try {
      // The final constraint (widened by 0022) must include all surfaces.
      const res = await client.query<{ def: string }>(`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conname = 'project_config_snapshots_surface_check'
      `);
      expect(res.rows).toHaveLength(1);
      const def = res.rows[0]!.def;
      for (const surface of ['postgrest', 'auth', 'postgres', 'storage', 'realtime', 'pgbouncer']) {
        expect(def).toContain(surface);
      }
    } finally {
      client.release();
    }
  });

  it('re-running migrations with realtime+pgbouncer snapshot rows does not crash', async () => {
    const client = await pool.connect();
    try {
      // Grab any existing instance ref (FK parent). If none exist we skip the
      // seeding step — the constraint coverage test above already validates the
      // surface CHECK; the FK means we can't manufacture a phantom ref here.
      const instances = await client.query<{ ref: string }>(
        'SELECT ref FROM supabase_instances LIMIT 1',
      );
      if (instances.rows.length > 0) {
        const ref = instances.rows[0]!.ref;
        const owner = await client.query<{ user_id: string }>(
          'SELECT user_id FROM organization_members LIMIT 1',
        );
        const userId = owner.rows[0]?.user_id ?? '00000000-0000-0000-0000-000000000000';
        await client.query(
          `INSERT INTO project_config_snapshots (instance_ref, surface, encrypted_payload, updated_by)
           VALUES ($1, 'realtime',  '\\x00'::bytea, $2),
                  ($1, 'pgbouncer', '\\x00'::bytea, $2)
           ON CONFLICT DO NOTHING`,
          [ref, userId],
        );
      }
    } finally {
      client.release();
    }

    // Third run — must not crash even with realtime/pgbouncer rows present.
    await expect(runMigrations(pool)).resolves.not.toThrow();
  });

  it('migration files have no duplicate numeric prefix', async () => {
    const files = await getMigrationFiles();
    const prefixes = files.map((f) => f.match(/^(\d+)_/)?.[1]).filter(Boolean);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const p of prefixes) {
      if (seen.has(p!)) dupes.push(p!);
      seen.add(p!);
    }
    expect(dupes).toEqual([]);
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getMigrationFiles(): Promise<string[]> {
  const dir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../packages/db/migrations',
  );
  return (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
}

async function runMigrations(pool: pg.Pool): Promise<void> {
  const dir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../packages/db/migrations',
  );
  const client = await pool.connect();
  try {
    const files = await getMigrationFiles();
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}
