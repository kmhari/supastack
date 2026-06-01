/**
 * Drizzle accessors for `oauth_codes` — single-use, short-lived authorization
 * codes. Atomic consume via UPDATE … WHERE used_at IS NULL RETURNING.
 *
 * Spec: 014-mcp-http-oauth — FR-001, contracts/oauth-token-endpoint.md.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';

export const CODE_TTL_SEC = 60;

export interface IssueCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
}

export interface IssueCodeResult {
  code: string;
  expiresAt: Date;
}

export type ConsumeCodeResult =
  | { ok: true; userId: string; scope: string; codeChallenge: string }
  | { ok: false; error: 'unknown' | 'reused' | 'expired' | 'mismatch' };

export async function issueCode(input: IssueCodeInput): Promise<IssueCodeResult> {
  const code = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CODE_TTL_SEC * 1000);
  await db().insert(schema.oauthCodes).values({
    code,
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Atomic single-use consume:
 *   UPDATE oauth_codes SET used_at = now()
 *   WHERE code = $1 AND used_at IS NULL
 *   RETURNING *
 *
 * - 0 rows + row-exists → 'reused'
 * - 0 rows + row-missing → 'unknown'
 * - row returned + expires_at < now() → 'expired' (rare race; also rolled back if needed)
 * - row returned + redirect_uri/client_id mismatch → 'mismatch'
 * - else → ok
 */
export async function consumeCode(
  code: string,
  expectedRedirectUri: string,
  expectedClientId: string,
): Promise<ConsumeCodeResult> {
  const [row] = await db()
    .update(schema.oauthCodes)
    .set({ usedAt: sql`now()` })
    .where(and(eq(schema.oauthCodes.code, code), isNull(schema.oauthCodes.usedAt)))
    .returning();

  if (!row) {
    // Either unknown or already used — disambiguate
    const [existing] = await db()
      .select({ usedAt: schema.oauthCodes.usedAt })
      .from(schema.oauthCodes)
      .where(eq(schema.oauthCodes.code, code))
      .limit(1);
    if (!existing) return { ok: false, error: 'unknown' };
    return { ok: false, error: 'reused' };
  }

  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'expired' };
  }
  if (row.redirectUri !== expectedRedirectUri) return { ok: false, error: 'mismatch' };
  if (row.clientId !== expectedClientId) return { ok: false, error: 'mismatch' };

  return { ok: true, userId: row.userId, scope: row.scope, codeChallenge: row.codeChallenge };
}
