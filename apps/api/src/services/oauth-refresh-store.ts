/**
 * Drizzle accessors for `oauth_refresh_tokens` — opaque rotating refresh
 * tokens with reuse-detection per RFC 6749 §10.4.
 *
 * Spec: 014-mcp-http-oauth — FR-009, contracts/oauth-token-endpoint.md.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';

export interface IssueRefreshInput {
  clientId: string;
  userId: string;
  scope: string;
  previousToken?: string;
}

export type RotateRefreshResult =
  | { ok: true; newToken: string; userId: string; scope: string }
  | { ok: false; error: 'unknown' | 'revoked' | 'reuse_detected' };

export async function issueRefresh(input: IssueRefreshInput): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db()
    .insert(schema.oauthRefreshTokens)
    .values({
      token,
      clientId: input.clientId,
      userId: input.userId,
      scope: input.scope,
      previousToken: input.previousToken ?? null,
    });
  return token;
}

/**
 * Rotation flow:
 * 1. Find the row by `token`.
 * 2. If missing entirely → 'unknown'.
 * 3. If `revoked_at IS NOT NULL` → 'revoked'.
 * 4. If a *different* live row has `previous_token = <this token>` → REUSE
 *    DETECTED. Revoke the entire (user, client) grant. Return 'reuse_detected'.
 * 5. Otherwise: delete the old row, insert a new one with `previous_token = <old>`.
 */
export async function rotateRefresh(
  oldToken: string,
  expectedClientId: string,
): Promise<RotateRefreshResult> {
  const [row] = await db()
    .select()
    .from(schema.oauthRefreshTokens)
    .where(eq(schema.oauthRefreshTokens.token, oldToken))
    .limit(1);

  if (!row) {
    // Check if it was already rotated (i.e., a child row has previous_token = <old>)
    const [child] = await db()
      .select()
      .from(schema.oauthRefreshTokens)
      .where(eq(schema.oauthRefreshTokens.previousToken, oldToken))
      .limit(1);
    if (child) {
      // Reuse-detection: someone is trying to use an already-rotated token. Revoke grant.
      await revokeRefreshByClient(child.clientId, child.userId);
      return { ok: false, error: 'reuse_detected' };
    }
    return { ok: false, error: 'unknown' };
  }

  if (row.revokedAt) return { ok: false, error: 'revoked' };
  if (row.clientId !== expectedClientId) return { ok: false, error: 'unknown' };

  // Rotate atomically: insert new, then delete old
  const newToken = randomBytes(32).toString('base64url');
  await db().transaction(async (tx) => {
    await tx.insert(schema.oauthRefreshTokens).values({
      token: newToken,
      clientId: row.clientId,
      userId: row.userId,
      scope: row.scope,
      previousToken: oldToken,
    });
    await tx.delete(schema.oauthRefreshTokens).where(eq(schema.oauthRefreshTokens.token, oldToken));
  });

  return { ok: true, newToken, userId: row.userId, scope: row.scope };
}

/**
 * Revoke ALL refresh tokens for (user, client). Returns count deleted.
 * Used by: dashboard revoke + reuse-detection.
 */
export async function revokeRefreshByClient(clientId: string, userId: string): Promise<number> {
  const rows = await db()
    .delete(schema.oauthRefreshTokens)
    .where(
      and(
        eq(schema.oauthRefreshTokens.clientId, clientId),
        eq(schema.oauthRefreshTokens.userId, userId),
      ),
    )
    .returning({ token: schema.oauthRefreshTokens.token });
  return rows.length;
}

/**
 * Bump last_used_at to keep the row alive against the 30-day idle GC.
 */
export async function touchRefresh(token: string): Promise<void> {
  await db()
    .update(schema.oauthRefreshTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(eq(schema.oauthRefreshTokens.token, token), isNull(schema.oauthRefreshTokens.revokedAt)),
    );
}
