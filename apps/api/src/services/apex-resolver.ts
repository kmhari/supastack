import { db } from '@supastack/db';
import * as schema from '@supastack/db/schema';

const TTL_MS = 60_000;

let cachedApex: string | null = null;
let fetchedAt = 0;

export async function resolveApex(): Promise<string | null> {
  if (process.env.SUPASTACK_APEX) return process.env.SUPASTACK_APEX;

  const now = Date.now();
  if (cachedApex !== null && now - fetchedAt < TTL_MS) return cachedApex;

  try {
    const [row] = await db().select({ apex: schema.org.apexDomain }).from(schema.org).limit(1);
    cachedApex = row?.apex ?? null;
    fetchedAt = now;

    if (cachedApex && process.env.SUPASTACK_APEX && cachedApex !== process.env.SUPASTACK_APEX) {
      console.warn(
        `[apex-resolver] SUPASTACK_APEX env (${process.env.SUPASTACK_APEX}) differs from DB (${cachedApex}); using env value`,
      );
    }
  } catch {
    // Keep stale cached value on DB error; return null if never fetched
  }

  return cachedApex;
}
