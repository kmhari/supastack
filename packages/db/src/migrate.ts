import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Idempotent migrations runner. Called at API/worker startup and from
 * `pnpm db:migrate`. Safe to invoke any number of times.
 *
 * All migration SQL is hand-written with `CREATE TABLE IF NOT EXISTS` /
 * `CREATE INDEX IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
 * so re-running is a no-op. We do NOT use drizzle-kit's migration runner at
 * runtime — that requires a journal/snapshot pair and is overkill for our
 * "single forward-only schema" v1.
 *
 * Order:
 *   1. Install required extensions (citext, pgcrypto)
 *   2. Apply migrations/*.sql in lexicographic order
 *   3. Add the org singleton partial unique index (constant-expression
 *      indexes are not auto-generatable by drizzle-kit)
 */
export async function migrate(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    // Extensions (idempotent)
    await client.query('CREATE EXTENSION IF NOT EXISTS citext');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Migration files
    const migrationsFolder =
      process.env.SUPASTACK_MIGRATIONS_DIR ??
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

    let files: string[] = [];
    try {
      files = (await readdir(migrationsFolder)).filter((f) => f.endsWith('.sql')).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    for (const file of files) {
      const sql = await readFile(path.join(migrationsFolder, file), 'utf8');
      await client.query(sql);
    }

    // Feature 084 — the old `org` singleton was split into `installation`
    // (apex+backups, with its own `CHECK (id = 1)`) + multi-row `organizations`,
    // so the legacy `org_singleton` index is gone. (Was: CREATE UNIQUE INDEX ...
    // ON org ((1::int)) — which crashed once `org` was dropped.)
  } finally {
    client.release();
    await pool.end();
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }
  migrate(url)
    .then(() => {
      console.error('migrations applied');
    })
    .catch((err) => {
      console.error('migrations failed:', err);
      process.exit(1);
    });
}
