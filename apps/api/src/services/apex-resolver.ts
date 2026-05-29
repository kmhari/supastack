import { db } from '@selfbase/db';
import * as schema from '@selfbase/db/schema';

const TTL_MS = 60_000;

let cachedApex: string | null = null;
let fetchedAt = 0;

export async function resolveApex(): Promise<string | null> {
  if (process.env.SELFBASE_APEX) return process.env.SELFBASE_APEX;

  const now = Date.now();
  if (cachedApex !== null && now - fetchedAt < TTL_MS) return cachedApex;

  try {
    const [row] = await db().select({ apex: schema.org.apexDomain }).from(schema.org).limit(1);
    cachedApex = row?.apex ?? null;
    fetchedAt = now;

    if (cachedApex && process.env.SELFBASE_APEX && cachedApex !== process.env.SELFBASE_APEX) {
      console.warn(
        `[apex-resolver] SELFBASE_APEX env (${process.env.SELFBASE_APEX}) differs from DB (${cachedApex}); using env value`,
      );
    }
  } catch {
    // Keep stale cached value on DB error; return null if never fetched
  }

  return cachedApex;
}
