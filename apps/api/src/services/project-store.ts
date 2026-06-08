/**
 * Project-scoped queries the management API uses for list/get/access-check.
 *
 * Today: every user in an org can see every instance in that org (the org
 * is a singleton, so effectively "all instances"). Per-instance RBAC is a
 * future concern; the access-check is structured here so the routes don't
 * need to be re-touched when scoping is added.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';

type InstanceRow = typeof schema.supabaseInstances.$inferSelect;

/**
 * Return all instances the user has access to via org_members. The
 * supabase_instances.orgId column is the join column.
 */
export async function listProjectsForUser(userId: string): Promise<InstanceRow[]> {
  const rows = await db()
    .select()
    .from(schema.supabaseInstances)
    .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
    .where(eq(schema.organizationMembers.userId, userId));
  // Drizzle's join shape is `{ supabase_instances: {...}, org_members: {...} }`;
  // extract the instance row.
  return rows.map((r) => r.supabase_instances);
}

/**
 * Return a single instance by ref iff the user has access. Returns null
 * for both "ref doesn't exist" and "ref exists but user can't see it"
 * so the route can emit a uniform 404 (FR-007: avoid leaking enumeration).
 */
export async function getProjectByRef(userId: string, ref: string): Promise<InstanceRow | null> {
  const rows = await db()
    .select()
    .from(schema.supabaseInstances)
    .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
    .where(and(eq(schema.supabaseInstances.ref, ref), eq(schema.organizationMembers.userId, userId)))
    .limit(1);
  return rows[0]?.supabase_instances ?? null;
}
