/**
 * Feature 122 — revoke the credentials a departing member reached an org through
 * (US3), per the confirmed strategy (research.md Q2, option C):
 *
 *  1. Revoke the user's OAuth grants (delete refresh tokens; best-effort blacklist
 *     of their recently-issued access-token jtis, which are 1h-lived anyway).
 *  2. Revoke the user's PATs OUTRIGHT only if the removal leaves them in ZERO
 *     orgs — in that state a PAT grants nothing legitimate, and leaving it live
 *     is the "make a new org to get it back" hole. A user still in another org
 *     keeps their PATs: 119's authorizeOrg already denies them the departed org's
 *     resources, and FR-009 requires the other orgs to be unaffected.
 *  3. Write an explicit credential_revocations record (FR-008) — who lost access
 *     to which org, when, by whom, and how much was revoked.
 *
 * Idempotent and safe to run when there is nothing to revoke.
 */
import { db, schema } from '@supastack/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { revoke as revokeJti } from '@supastack/oauth';
import { logger } from '@supastack/shared';
import { Redis } from 'ioredis';

// Per-process Redis client, matching the pattern in oauth/clients-dashboard.ts.
let redisSingleton: Redis | null = null;
function getRedis(): Redis {
  if (!redisSingleton) redisSingleton = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');
  return redisSingleton;
}

export interface RevocationResult {
  patsRevoked: number;
  oauthGrantsRevoked: number;
  hadRemainingOrgs: boolean;
}

/**
 * Revoke on member removal. `userId` was removed from `organizationId` by
 * `actorUserId`. Call AFTER the membership row is deleted, so the zero-org check
 * reflects the post-removal state.
 */
export async function revokeCredentialsOnMemberRemoval(
  userId: string,
  organizationId: string,
  actorUserId: string | null,
  reason = 'member_removed',
): Promise<RevocationResult> {
  // 1. OAuth: best-effort blacklist of the user's recently-issued jtis (1h TTL),
  //    then delete every refresh token they hold so no new access token mints.
  let oauthGrantsRevoked = 0;
  try {
    const redis = getRedis();
    const recent = await db()
      .select({ payload: schema.auditLog.payload, createdAt: schema.auditLog.createdAt })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.actorUserId, userId),
          sql`${schema.auditLog.action} IN ('oauth.token.issued', 'oauth.token.refreshed')`,
          sql`${schema.auditLog.createdAt} > now() - interval '1 hour'`,
        ),
      )
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(100);
    const oneHourMs = 60 * 60 * 1000;
    const now = Date.now();
    for (const row of recent) {
      const jti = (row.payload as Record<string, unknown> | null)?.jti as string | undefined;
      if (!jti) continue;
      const remainingSec = Math.max(
        1,
        Math.floor((oneHourMs - (now - row.createdAt.getTime())) / 1000),
      );
      await revokeJti(redis, jti, remainingSec);
    }
    const deleted = await db()
      .delete(schema.oauthRefreshTokens)
      .where(eq(schema.oauthRefreshTokens.userId, userId))
      .returning({ token: schema.oauthRefreshTokens.token });
    oauthGrantsRevoked = deleted.length;
  } catch (err) {
    logger.warn({ err, userId }, 'oauth revocation on member removal failed (continuing)');
  }

  // 2. PATs: only when the user now has zero org memberships.
  const remaining = await db()
    .select({ organizationId: schema.organizationMembers.organizationId })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, userId))
    .limit(1);
  const hadRemainingOrgs = remaining.length > 0;

  let patsRevoked = 0;
  if (!hadRemainingOrgs) {
    const revoked = await db()
      .update(schema.apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiTokens.userId, userId), isNull(schema.apiTokens.revokedAt)))
      .returning({ id: schema.apiTokens.id });
    patsRevoked = revoked.length;
  }

  // 3. Explicit revocation record (FR-008).
  await db().insert(schema.credentialRevocations).values({
    userId,
    organizationId,
    reason,
    actorUserId,
    patsRevoked,
    oauthGrantsRevoked,
  });

  // 4. Audit the removal and its resulting revocations (FR-011).
  await db().insert(schema.auditLog).values({
    actorUserId,
    action: 'member.credentials-revoked',
    targetKind: 'user',
    targetId: userId,
    payload: { organizationId, reason, patsRevoked, oauthGrantsRevoked, hadRemainingOrgs },
  });

  return { patsRevoked, oauthGrantsRevoked, hadRemainingOrgs };
}
