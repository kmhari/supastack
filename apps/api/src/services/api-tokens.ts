import { randomBytes, createHash } from 'node:crypto';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres';
import { schema } from '@selfbase/db';

type Schema = typeof schema;
/** Accepts either the global db() or a transactional client. */
export type Inserter =
  | NodePgDatabase<Schema>
  | NodePgTransaction<Schema, ExtractTablesWithRelations<Schema>>;

/**
 * Mint a fresh API token. Returns the raw token (shown ONCE to the caller)
 * and writes its SHA-256 hash to the DB. Subsequent lookups match against
 * the hash; raw tokens never live in storage.
 *
 * Format: `sb_` + 32 random bytes hex-encoded = 67 chars total.
 */
export async function mintApiToken(
  tx: Inserter,
  userId: string,
  label: string,
): Promise<{ raw: string; id: string }> {
  const raw = `sb_${randomBytes(32).toString('hex')}`;
  const sha256 = createHash('sha256').update(raw, 'utf8').digest();
  const [row] = await tx
    .insert(schema.apiTokens)
    .values({ userId, tokenSha256: sha256, label })
    .returning({ id: schema.apiTokens.id });
  return { raw, id: row!.id };
}
