/**
 * Cleanup expired OAuth authorization codes — feature 014 FR-024a.
 *
 * Runs every 60s. DELETE WHERE expires_at < now(). Idempotent + safe to
 * overlap a previous run (PG handles concurrent DELETE on the same range).
 *
 * Codes are ≤60s lived; this job keeps the table small.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { logger } from '@supastack/shared';

export interface CleanupResult {
  deletedCount: number;
}

export async function runCleanupOauthCodes(): Promise<CleanupResult> {
  const rows = await db()
    .delete(schema.oauthCodes)
    .where(sql`${schema.oauthCodes.expiresAt} < now()`)
    .returning({ code: schema.oauthCodes.code });
  if (rows.length > 0) {
    logger.info({ deleted: rows.length }, 'cleanup-oauth-codes deleted expired codes');
  }
  return { deletedCount: rows.length };
}

export async function handleCleanupOauthCodes(): Promise<void> {
  await runCleanupOauthCodes();
}
