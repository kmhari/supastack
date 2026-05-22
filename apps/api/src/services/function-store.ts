/**
 * Read-side queries against per-instance edge function state.
 *
 * The DB (`project_functions`) is the canonical index. The bytes live on
 * disk under /var/selfbase/instances/<ref>/volumes/functions/<slug>/.
 *
 * Spec: T037 — list / get / body / delete. Writes happen in function-deploy.ts.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import type { FunctionRecord } from '@selfbase/shared';
import { functionRowToFunction } from './mgmt-api-mapping.js';

type FunctionRow = typeof schema.projectFunctions.$inferSelect;

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';

export function instanceFunctionsDir(ref: string): string {
  return path.join(INSTANCES_DIR, ref, 'volumes', 'functions');
}

export function slugDir(ref: string, slug: string): string {
  return path.join(instanceFunctionsDir(ref), slug);
}

export async function listFunctions(ref: string): Promise<FunctionRecord[]> {
  const rows = await db()
    .select()
    .from(schema.projectFunctions)
    .where(
      and(
        eq(schema.projectFunctions.instanceRef, ref),
        eq(schema.projectFunctions.status, 'ACTIVE'),
      ),
    );
  return rows.map(functionRowToFunction);
}

export async function getFunction(
  ref: string,
  slug: string,
): Promise<FunctionRow | null> {
  const rows = await db()
    .select()
    .from(schema.projectFunctions)
    .where(
      and(
        eq(schema.projectFunctions.instanceRef, ref),
        eq(schema.projectFunctions.slug, slug),
        eq(schema.projectFunctions.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Hard-delete: removes both the DB row and the on-disk slug directory. */
export async function deleteFunction(ref: string, slug: string): Promise<boolean> {
  const row = await getFunction(ref, slug);
  if (!row) return false;
  await db()
    .delete(schema.projectFunctions)
    .where(
      and(
        eq(schema.projectFunctions.instanceRef, ref),
        eq(schema.projectFunctions.slug, slug),
      ),
    );
  await rm(slugDir(ref, slug), { recursive: true, force: true });
  return true;
}
