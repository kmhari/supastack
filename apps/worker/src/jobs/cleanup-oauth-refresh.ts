/**
 * Cleanup idle-aged OAuth refresh tokens — feature 014 FR-024a.
 *
 * Runs every hour. DELETE WHERE last_used_at < now() - 30d AND revoked_at IS NULL.
 * Idempotent. Revoked tokens are kept (audit trail) until their natural cleanup
 * via the revocations table — they're DB-cheap and forensically useful.
 */
import { sql, isNull, and, lt } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { logger } from '@supastack/shared';

export interface CleanupResult {
  deletedCount: number;
}

export async function runCleanupOauthRefresh(): Promise<CleanupResult> {
  const rows = await db()
    .delete(schema.oauthRefreshTokens)
    .where(
      and(
        lt(schema.oauthRefreshTokens.lastUsedAt, sql`now() - interval '30 days'`),
        isNull(schema.oauthRefreshTokens.revokedAt),
      ),
    )
    .returning({ token: schema.oauthRefreshTokens.token });
  if (rows.length > 0) {
    logger.info({ deleted: rows.length }, 'cleanup-oauth-refresh deleted idle tokens');
  }
  return { deletedCount: rows.length };
}

export async function handleCleanupOauthRefresh(): Promise<void> {
  await runCleanupOauthRefresh();
}
