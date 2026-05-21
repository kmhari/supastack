import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Idempotent migrations runner. Called at API/worker startup and from
 * `pnpm db:migrate`. Safe to invoke any number of times.
 *
 * Drizzle migrations are CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
 * EXISTS by convention in this repo. Plus we install the citext extension
 * and the org singleton index here (not auto-generatable by drizzle-kit).
 */
export async function migrate(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const db = drizzle(pool);

  // Extensions (idempotent)
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS citext`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`); // for gen_random_uuid

  // Drizzle schema migrations
  const migrationsFolder =
    process.env.SELFBASE_MIGRATIONS_DIR ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  await drizzleMigrate(db, { migrationsFolder });

  // Singleton constraint on org — see data-model.md §I1 fix.
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS org_singleton ON org ((1::int))`);

  await pool.end();
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
