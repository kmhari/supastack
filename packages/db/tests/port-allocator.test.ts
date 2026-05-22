import { describe, expect, test } from 'vitest';

/**
 * Port allocator test is INTEGRATION-style — it needs a real Postgres because
 * the allocator relies on `generate_series` and `pg_advisory_xact_lock`.
 *
 * In CI we run this against a containerized postgres:16. Locally, set
 * `TEST_DATABASE_URL` to point at a scratch DB and the test suite picks it up.
 * If the env var is missing, the test is SKIPPED with a clear message so
 * `pnpm test` doesn't fail on developer machines without Postgres.
 */
const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('port-allocator (integration)', () => {
  test('allocates 5 disjoint ports in range', async () => {
    expect(TEST_DB).toBeTruthy();
    // Lazy-load so the import doesn't crash on developer machines without
    // pg/drizzle installed yet.
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { allocatePorts } = await import('../src/port-allocator.js');
    const { migrate } = await import('../src/migrate.js');
    const schema = await import('../src/schema/index.js');

    await migrate(TEST_DB!);
    const pool = new Pool({ connectionString: TEST_DB });
    const db = drizzle(pool, { schema });

    // Need an instance row first (FK). Insert a stub.
    await db.execute(
      /* sql */ `
      INSERT INTO org (name) VALUES ('test') ON CONFLICT DO NOTHING;
    ` as never,
    );
    // Skipping the full instance insert — port_allocations.instance_ref has
    // an ON DELETE SET NULL FK, but the column is also nullable, so we can
    // pass a non-existent ref temporarily for the allocation test as long as
    // we delete the rows afterward.

    const ref1 = 'testref1234testref1';
    const ports = await allocatePorts(db, ref1, { rangeStart: 40000, rangeEnd: 40050 });

    expect(new Set(Object.values(ports)).size).toBe(5);
    for (const p of Object.values(ports)) {
      expect(p).toBeGreaterThanOrEqual(40000);
      expect(p).toBeLessThanOrEqual(40050);
    }

    // Cleanup
    await db.execute(
      /* sql */ `DELETE FROM port_allocations WHERE instance_ref = '${ref1}';` as never,
    );
    await pool.end();
  });

  test('concurrent allocations never overlap', async () => {
    expect(TEST_DB).toBeTruthy();
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { allocatePorts } = await import('../src/port-allocator.js');
    const schema = await import('../src/schema/index.js');

    const pool = new Pool({ connectionString: TEST_DB });
    const db = drizzle(pool, { schema });

    const refs = Array.from({ length: 5 }, (_, i) =>
      `concref0000concref${i}`.padEnd(20, '0').slice(0, 20),
    );
    const results = await Promise.all(
      refs.map((ref) => allocatePorts(db, ref, { rangeStart: 41000, rangeEnd: 41040 })),
    );

    const all = results.flatMap((r) => Object.values(r));
    expect(new Set(all).size).toBe(all.length); // no duplicates

    // Cleanup
    for (const ref of refs) {
      await db.execute(
        /* sql */ `DELETE FROM port_allocations WHERE instance_ref = '${ref}';` as never,
      );
    }
    await pool.end();
  });
});

describe('port-allocator (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../src/port-allocator.js');
    expect(typeof mod.allocatePorts).toBe('function');
    expect(mod.PORT_KINDS).toEqual(['kong', 'studio', 'postgres', 'pooler', 'analytics']);
  });
});
