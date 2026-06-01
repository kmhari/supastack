import { sql } from 'drizzle-orm';
import type { SupastackDb } from './client.js';
import { portAllocations } from './schema/instances.js';

export const PORT_KINDS = [
  'kong',
  'studio',
  'postgres',
  'pooler',
  'analytics',
  'dbDirect',
] as const;
export type PortKind = (typeof PORT_KINDS)[number];

export interface PortAllocation {
  kong: number;
  studio: number;
  postgres: number;
  pooler: number;
  analytics: number;
  // db's plaintext 5432 published on the host for the pg-edge proxy (feature 005).
  dbDirect: number;
}

export interface PortAllocatorOptions {
  /** Default 30000–39999. */
  rangeStart?: number;
  rangeEnd?: number;
  /** Number of retry attempts on unique-constraint conflict. */
  retries?: number;
}

/**
 * Atomically allocate 5 ports for a new instance. Uses a single transaction:
 * we pick 5 consecutive free integers from the range (queried with FOR UPDATE
 * skip-locked semantics via `pg_advisory_xact_lock`) and insert them. On any
 * unique-constraint conflict we retry — typically because of a concurrent
 * allocator picking the same window.
 *
 * Returns the allocated PortAllocation. Throws if the range is exhausted.
 */
/**
 * `instanceRef` is OPTIONAL because the supabase_instances row may not exist
 * yet at allocation time (FK ordering). Callers that already have the row
 * can pass it for immediate linkage; callers in a "create-new-instance"
 * flow should pass null and then call `assignPortsToInstance` once they've
 * inserted the supabase_instances row.
 */
export async function allocatePorts(
  db: SupastackDb,
  instanceRef: string | null,
  opts: PortAllocatorOptions = {},
): Promise<PortAllocation> {
  const start = opts.rangeStart ?? 30000;
  const end = opts.rangeEnd ?? 39999;
  const retries = opts.retries ?? 8;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        // Serialize concurrent allocators with an advisory xact lock — cheap.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${42})`);

        // Find the lowest 5 free ports in the range. We do this by:
        // 1) generate_series of the range
        // 2) LEFT JOIN against port_allocations
        // 3) WHERE allocation is null
        // 4) ORDER BY port ASC LIMIT 5
        const rows = await tx.execute<{ port: number }>(sql`
          SELECT p AS port
          FROM generate_series(${start}::int, ${end}::int) p
          LEFT JOIN port_allocations a ON a.port = p
          WHERE a.port IS NULL
          ORDER BY p ASC
          LIMIT 6
        `);

        if (rows.rows.length < 6) {
          throw new PortPoolExhaustedError(start, end);
        }

        const [kong, studio, postgres, pooler, analytics, dbDirect] = rows.rows.map((r) =>
          Number(r.port),
        );

        await tx.insert(portAllocations).values([
          { port: kong!, kind: 'kong', instanceRef: instanceRef ?? null },
          { port: studio!, kind: 'studio', instanceRef: instanceRef ?? null },
          { port: postgres!, kind: 'postgres', instanceRef: instanceRef ?? null },
          { port: pooler!, kind: 'pooler', instanceRef: instanceRef ?? null },
          { port: analytics!, kind: 'analytics', instanceRef: instanceRef ?? null },
          { port: dbDirect!, kind: 'dbDirect', instanceRef: instanceRef ?? null },
        ]);

        return {
          kong: kong!,
          studio: studio!,
          postgres: postgres!,
          pooler: pooler!,
          analytics: analytics!,
          dbDirect: dbDirect!,
        };
      });
    } catch (err) {
      if (err instanceof PortPoolExhaustedError) throw err;
      const code = (err as { code?: string }).code;
      if (code === '23505') continue; // unique-constraint conflict — retry
      throw err;
    }
  }
  throw new Error(`port allocator: exhausted ${retries} retries due to contention`);
}

export async function releasePortsForInstance(db: SupastackDb, instanceRef: string): Promise<void> {
  await db.execute(sql`DELETE FROM port_allocations WHERE instance_ref = ${instanceRef}`);
}

/**
 * Backfill `instance_ref` on the 5 port_allocations rows after the
 * supabase_instances row has been inserted. Called by the create-instance
 * flow inside the same transaction.
 */
export async function assignPortsToInstance(
  db: SupastackDb,
  instanceRef: string,
  ports: PortAllocation,
): Promise<void> {
  // Set instance_ref on each of the 5 allocated rows individually. Avoids
  // array-cast headaches with pg's parameter binding.
  for (const port of [
    ports.kong,
    ports.studio,
    ports.postgres,
    ports.pooler,
    ports.analytics,
    ports.dbDirect,
  ]) {
    await db.execute(
      sql`UPDATE port_allocations SET instance_ref = ${instanceRef} WHERE port = ${port}`,
    );
  }
}

export class PortPoolExhaustedError extends Error {
  constructor(start: number, end: number) {
    super(`no free ports available in range ${start}-${end}`);
    this.name = 'PortPoolExhaustedError';
  }
}
