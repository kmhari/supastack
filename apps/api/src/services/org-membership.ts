/**
 * Org membership + invitation helpers (feature 084 — US3/US4).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';

export const INVITE_TTL_HOURS = 24;

export function newInviteToken(): { raw: string; sha256: Buffer; expiresAt: Date } {
  const raw = randomBytes(32).toString('hex');
  return {
    raw,
    sha256: createHash('sha256').update(raw, 'utf8').digest(),
    expiresAt: new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000),
  };
}

export function hashInviteToken(raw: string): Buffer {
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** Number of `owner`-role members in an org (for the last-owner invariant). */
export async function ownerCount(orgId: string): Promise<number> {
  const rows = await db()
    .select({ userId: schema.organizationMembers.userId })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, orgId),
        eq(schema.organizationMembers.role, 'owner'),
      ),
    );
  return rows.length;
}

/** The caller's stored role string in an org, or null if not a member. */
export async function memberRole(orgId: string, userId: string): Promise<string | null> {
  const [row] = await db()
    .select({ role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.organizationId, orgId),
        eq(schema.organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}
