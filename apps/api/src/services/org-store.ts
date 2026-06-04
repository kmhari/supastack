import { schema } from '@supastack/db';
import { generateRef } from '@supastack/crypto';
import type { Inserter } from './api-tokens.js';

/**
 * Create a tenant organization plus its owner membership — the single shared
 * primitive used by both `POST /platform/organizations` (platform studio) and
 * the first-install setup flow (feature 086).
 *
 * Takes an `Inserter` (the global `db()` or a transaction handle) so the caller
 * owns the transaction boundary: setup runs this inside its bootstrap tx
 * (installation + setup_state + master PAT must commit atomically with the org),
 * while the platform route wraps it in its own one-shot `db().transaction`.
 *
 * Performs no authorization — callers gate access (the platform route via
 * `requireAuth`; setup via the unauthenticated, `setup_state`-gated bootstrap).
 * `name` is assumed already trimmed/validated by the caller.
 */
export async function createOrganizationWithOwner(
  tx: Inserter,
  { userId, name }: { userId: string; name: string },
): Promise<{ id: string; name: string }> {
  const id = generateRef();
  await tx.insert(schema.organizations).values({ id, name });
  await tx
    .insert(schema.organizationMembers)
    .values({ organizationId: id, userId, role: 'owner' });
  return { id, name };
}
