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
  test('allocates 6 disjoint ports in range', async () => {
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

    await pool.query(`DELETE FROM port_allocations WHERE port BETWEEN 40000 AND 40050`);

    const ports = await allocatePorts(db, null, { rangeStart: 40000, rangeEnd: 40050 });

    expect(new Set(Object.values(ports)).size).toBe(6);
    for (const p of Object.values(ports)) {
      expect(p).toBeGreaterThanOrEqual(40000);
      expect(p).toBeLessThanOrEqual(40050);
    }

    // Cleanup
    await pool.query(`DELETE FROM port_allocations WHERE port BETWEEN 40000 AND 40050`);
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

    await pool.query(`DELETE FROM port_allocations WHERE port BETWEEN 41000 AND 41060`);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        allocatePorts(db, null, { rangeStart: 41000, rangeEnd: 41060 }),
      ),
    );

    const all = results.flatMap((r) => Object.values(r));
    expect(new Set(all).size).toBe(all.length); // no duplicates

    await pool.query(`DELETE FROM port_allocations WHERE port BETWEEN 41000 AND 41060`);
    await pool.end();
  });
});

describe.skipIf(!TEST_DB)('port-allocator concurrency (T051)', () => {
  test('16 concurrent allocators produce 96 unique ports inside the range (NULL instance_ref)', async () => {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { allocatePorts } = await import('../src/port-allocator.js');
    const { migrate } = await import('../src/migrate.js');
    const schema = await import('../src/schema/index.js');

    await migrate(TEST_DB!);
    const pool = new Pool({ connectionString: TEST_DB, max: 20 });
    const db = drizzle(pool, { schema });

    const N = 16;
    const rangeStart = 42000;
    const rangeEnd = 42000 + N * 6 + 20; // headroom for retries

    // Clean slate for the range.
    await pool.query(`DELETE FROM port_allocations WHERE port BETWEEN $1 AND $2`, [
      rangeStart,
      rangeEnd,
    ]);

    try {
      const results = await Promise.all(
        Array.from({ length: N }, () => allocatePorts(db, null, { rangeStart, rangeEnd })),
      );

      const all = results.flatMap((r) => Object.values(r));
      expect(all.length).toBe(N * 6);
      expect(new Set(all).size).toBe(all.length); // no duplicates
      for (const p of all) {
        expect(p).toBeGreaterThanOrEqual(rangeStart);
        expect(p).toBeLessThanOrEqual(rangeEnd);
      }
    } finally {
      await pool.query(`DELETE FROM port_allocations WHERE port BETWEEN $1 AND $2`, [
        rangeStart,
        rangeEnd,
      ]);
      await pool.end();
    }
  });

  test('range exactly fits one allocation (6 ports) and a second request exhausts', async () => {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { allocatePorts, PortPoolExhaustedError } = await import('../src/port-allocator.js');
    const schema = await import('../src/schema/index.js');

    const pool = new Pool({ connectionString: TEST_DB });
    const db = drizzle(pool, { schema });

    await pool.query(`DELETE FROM port_allocations WHERE port BETWEEN 43000 AND 43005`);
    try {
      const first = await allocatePorts(db, null, { rangeStart: 43000, rangeEnd: 43005 });
      expect(new Set(Object.values(first)).size).toBe(6);
      for (const p of Object.values(first)) {
        expect(p).toBeGreaterThanOrEqual(43000);
        expect(p).toBeLessThanOrEqual(43005);
      }

      // Range is now fully consumed — second call must throw PortPoolExhausted.
      await expect(
        allocatePorts(db, null, { rangeStart: 43000, rangeEnd: 43005 }),
      ).rejects.toBeInstanceOf(PortPoolExhaustedError);
    } finally {
      await pool.query(`DELETE FROM port_allocations WHERE port BETWEEN 43000 AND 43005`);
      await pool.end();
    }
  });

  test('range too small to satisfy a single allocation throws immediately', async () => {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { allocatePorts, PortPoolExhaustedError } = await import('../src/port-allocator.js');
    const schema = await import('../src/schema/index.js');

    const pool = new Pool({ connectionString: TEST_DB });
    const db = drizzle(pool, { schema });
    try {
      await expect(
        allocatePorts(db, null, { rangeStart: 44000, rangeEnd: 44003 }),
      ).rejects.toBeInstanceOf(PortPoolExhaustedError);
    } finally {
      await pool.end();
    }
  });

  test('releasePortsForInstance is a no-op for an unknown ref and does not throw', async () => {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { releasePortsForInstance } = await import('../src/port-allocator.js');
    const schema = await import('../src/schema/index.js');

    const pool = new Pool({ connectionString: TEST_DB });
    const db = drizzle(pool, { schema });
    try {
      await expect(releasePortsForInstance(db, 'ref_does_not_exist__')).resolves.toBeUndefined();
    } finally {
      await pool.end();
    }
  });
});

describe('port-allocator (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../src/port-allocator.js');
    expect(typeof mod.allocatePorts).toBe('function');
    expect(mod.PORT_KINDS).toEqual([
      'kong',
      'studio',
      'postgres',
      'pooler',
      'analytics',
      'dbDirect',
    ]);
  });

  test('PortPoolExhaustedError carries range in its message', async () => {
    const { PortPoolExhaustedError } = await import('../src/port-allocator.js');
    const err = new PortPoolExhaustedError(1000, 1005);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PortPoolExhaustedError');
    expect(err.message).toContain('1000');
    expect(err.message).toContain('1005');
  });
});
