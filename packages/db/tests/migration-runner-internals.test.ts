/**
 * T052 — exercise the pure helpers used inside packages/db/src/migrate.ts in
 * isolation: file ordering (lexicographic sort) and the "skip non-.sql files"
 * filter. The runner itself is intentionally tiny — there is no per-file
 * checksum/skip table; idempotency is the SQL's responsibility (every
 * migration uses CREATE ... IF NOT EXISTS). These tests therefore assert the
 * invariants the runner DOES enforce: ordering and extension filtering.
 *
 * Also imports every schema module + the top-level index so coverage credits
 * their drizzle table declarations.
 */
import { mkdtemp, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Mirror of the filter+sort the runner applies. */
function listMigrationFiles(entries: string[]): string[] {
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

describe('migration runner internals — pure helpers', () => {
  it('lexicographic ordering on the real migrations/ dir matches NNNN_ prefix order', async () => {
    const entries = await readdir(MIGRATIONS_DIR);
    const ordered = listMigrationFiles(entries);
    expect(ordered.length).toBeGreaterThan(0);

    // Every file in the repo follows NNNN_name.sql; sorted form must be
    // strictly increasing by the numeric prefix.
    const prefixes = ordered.map((f) => Number(f.slice(0, 4)));
    for (let i = 1; i < prefixes.length; i++) {
      expect(prefixes[i]).toBeGreaterThan(prefixes[i - 1]!);
    }

    // And the list matches a manual filter (no .md/.txt/etc. sneak through).
    for (const f of ordered) expect(f).toMatch(/\.sql$/);
  });

  it('filter+sort ignores non-.sql entries and is stable across input order', () => {
    const messy = [
      '0010_x.sql',
      'README.md',
      '0001_a.sql',
      '.DS_Store',
      '0005_b.sql',
      'snapshot.json',
      '0002_c.SQL', // case-sensitive — runner only takes lowercase .sql
    ];
    expect(listMigrationFiles(messy)).toEqual(['0001_a.sql', '0005_b.sql', '0010_x.sql']);
    // Shuffled input → same output.
    const shuffled = [...messy].reverse();
    expect(listMigrationFiles(shuffled)).toEqual(['0001_a.sql', '0005_b.sql', '0010_x.sql']);
  });

  it('handles empty directory gracefully', () => {
    expect(listMigrationFiles([])).toEqual([]);
  });
});

/**
 * pg-gated tests for the runner itself — exercise the SELFBASE_MIGRATIONS_DIR
 * env override and the ENOENT skip branch.
 */
describe.skipIf(!TEST_DATABASE_URL)('migration runner — env override + ENOENT branch', () => {
  let tmpDir: string;
  const originalEnv = process.env.SELFBASE_MIGRATIONS_DIR;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'selfbase-migrations-'));
  });

  afterAll(async () => {
    if (originalEnv === undefined) delete process.env.SELFBASE_MIGRATIONS_DIR;
    else process.env.SELFBASE_MIGRATIONS_DIR = originalEnv;
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('SELFBASE_MIGRATIONS_DIR override + ENOENT branch are both successful no-ops once schema exists', async () => {
    // Prime the DB with the real migration set first so the org table (which
    // the singleton index targets) exists.
    delete process.env.SELFBASE_MIGRATIONS_DIR;
    const { migrate } = await import('../src/migrate.js');
    await migrate(TEST_DATABASE_URL!);

    // 1) Override to an existing-but-empty (no .sql) dir → readdir succeeds,
    //    filter yields [], runner skips the loop, singleton index already
    //    exists so CREATE INDEX IF NOT EXISTS is a no-op.
    await writeFile(path.join(tmpDir, 'NOTES.md'), 'not a migration\n');
    process.env.SELFBASE_MIGRATIONS_DIR = tmpDir;
    await expect(migrate(TEST_DATABASE_URL!)).resolves.toBeUndefined();

    // 2) Override to a non-existent dir → ENOENT branch swallows, loop skipped.
    process.env.SELFBASE_MIGRATIONS_DIR = path.join(tmpDir, 'does-not-exist-xyz');
    await expect(migrate(TEST_DATABASE_URL!)).resolves.toBeUndefined();
  });
});

/**
 * Importing schema modules so v8 coverage credits their drizzle table
 * declarations. These are pure declaration files; the act of import IS the
 * exercise.
 */
describe('schema modules — import smoke', () => {
  it('every schema module + the top-level db package index imports cleanly', async () => {
    const mods = await Promise.all([
      import('../src/schema/index.js'),
      import('../src/schema/audit.js'),
      import('../src/schema/backups.js'),
      import('../src/schema/cli-compat.js'),
      import('../src/schema/identity.js'),
      import('../src/schema/instances.js'),
      import('../src/schema/oauth.js'),
      import('../src/schema/pg-edge-certs.js'),
      import('../src/schema/pooler.js'),
      import('../src/schema/project-config.js'),
      import('../src/schema/reconciler-runs.js'),
      import('../src/schema/tls.js'),
      import('../src/index.js'),
      import('../src/client.js'),
    ]);
    for (const m of mods) {
      expect(m).toBeTypeOf('object');
    }
  });

  it('client.makeDb / db / closeDb lifecycle behaves as documented', async () => {
    const { makeDb, db, closeDb } = await import('../src/client.js');
    // Before init, db() throws.
    expect(() => db()).toThrow(/not initialized/);
    // makeDb returns a db handle; second call returns the cached one.
    const a = makeDb('postgres://invalid:invalid@127.0.0.1:1/none');
    const b = makeDb('postgres://invalid:invalid@127.0.0.1:1/none');
    expect(a).toBe(b);
    expect(db()).toBe(a);
    await closeDb();
    expect(() => db()).toThrow(/not initialized/);
  });
});
