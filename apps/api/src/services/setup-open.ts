/**
 * First-run trust window. While setup is open (no setup_state.completedAt —
 * i.e. no admin exists yet), the apex + wildcard-cert endpoints are reachable
 * unauthenticated so the /setup wizard can run its DNS + certificate step
 * BEFORE account creation — letting the admin password be submitted over
 * HTTPS on the real domain instead of plain http://<ip>. This widens nothing:
 * POST /setup itself is already unauthenticated in the same window (first
 * visitor owns a fresh box, inherent to first-run setup). The instant setup
 * completes, every guarded route reverts to normal RBAC.
 */
import { db, schema } from '@supastack/db';
import { eq } from 'drizzle-orm';

export async function setupIsOpen(): Promise<boolean> {
  const row = await db()
    .select({ completedAt: schema.setupState.completedAt })
    .from(schema.setupState)
    .where(eq(schema.setupState.id, 1))
    .limit(1);
  return (row[0]?.completedAt ?? null) === null;
}
