import { sql } from 'drizzle-orm';
import { portAllocations } from './schema/instances.js';
import type { SelfbaseDb } from './client.js';

export const PORT_KINDS = ['kong', 'studio', 'postgres', 'pooler', 'analytics'] as const;
export type PortKind = (typeof PORT_KINDS)[number];

export interface PortAllocation {
  kong: number;
  studio: number;
  postgres: number;
  pooler: number;
  analytics: number;
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
export async function allocatePorts(
  db: SelfbaseDb,
  instanceRef: string,
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
          FROM generate_series(${start}, ${end}) p
          LEFT JOIN port_allocations a ON a.port = p
          WHERE a.port IS NULL
          ORDER BY p ASC
          LIMIT 5
        `);

        if (rows.rows.length < 5) {
          throw new PortPoolExhaustedError(start, end);
        }

        const [kong, studio, postgres, pooler, analytics] = rows.rows.map((r) => Number(r.port));

        await tx.insert(portAllocations).values([
          { port: kong!, kind: 'kong', instanceRef },
          { port: studio!, kind: 'studio', instanceRef },
          { port: postgres!, kind: 'postgres', instanceRef },
          { port: pooler!, kind: 'pooler', instanceRef },
          { port: analytics!, kind: 'analytics', instanceRef },
        ]);

        return { kong: kong!, studio: studio!, postgres: postgres!, pooler: pooler!, analytics: analytics! };
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

export async function releasePortsForInstance(db: SelfbaseDb, instanceRef: string): Promise<void> {
  await db.execute(sql`DELETE FROM port_allocations WHERE instance_ref = ${instanceRef}`);
}

export class PortPoolExhaustedError extends Error {
  constructor(start: number, end: number) {
    super(`no free ports available in range ${start}-${end}`);
    this.name = 'PortPoolExhaustedError';
  }
}
