/**
 * Zod schemas for /v1/projects/<ref>/postgrest.
 *
 * Bounds pulled from upstream OpenAPI snapshot at
 * specs/009-runtime-config-tunables/upstream-openapi-snapshot.json
 * — components.schemas.V1UpdatePostgrestConfigBody (PATCH input)
 * — components.schemas.V1PostgrestConfigResponse  (GET/PATCH output)
 *
 * Spec: specs/009-runtime-config-tunables/spec.md FR-001..FR-002, FR-005.
 * Contract: contracts/postgrest-config.md
 */
import { z } from 'zod';

// ─── PATCH request body ────────────────────────────────────────────────────
//
// strict() → unknown fields → ZodError, which the mgmt-api-errors plugin
// turns into 400 { error: { details: { <field>: 'unknown_field' } } }.
//
// All fields optional; PATCH semantics are merge-over-existing.
//
// Upstream bounds (verified 2026-05-25 against api.supabase.com/api/v1-json):
//   max_rows: integer, 0..1_000_000
//   db_pool:  integer, 0..1_000     (nullable — null means "auto-configured")
//   db_schema, db_extra_search_path: string (no bounds)
export const UpdatePostgrestConfigBodySchema = z
  .object({
    db_schema: z.string().min(1).optional(),
    db_extra_search_path: z.string().optional(),
    max_rows: z.number().int().min(0).max(1_000_000).optional(),
    db_pool: z.number().int().min(0).max(1_000).nullable().optional(),
  })
  .strict();

export type UpdatePostgrestConfigBody = z.infer<typeof UpdatePostgrestConfigBodySchema>;

// ─── GET / PATCH response ──────────────────────────────────────────────────
//
// All four fields required in the response. db_pool is nullable in upstream
// (null ⇒ auto-configured).
export const PostgrestConfigResponseSchema = z.object({
  db_schema: z.string(),
  db_extra_search_path: z.string(),
  max_rows: z.number().int(),
  db_pool: z.number().int().nullable(),
});

export type PostgrestConfigResponse = z.infer<typeof PostgrestConfigResponseSchema>;

// ─── Upstream-documented defaults ──────────────────────────────────────────
//
// Used when no project_config_snapshots row exists yet for (ref, 'postgrest').
// Sourced from the per-instance template `.env.example` and the upstream
// PostgrestConfigResponse schema defaults.
export const POSTGREST_CONFIG_DEFAULTS: PostgrestConfigResponse = {
  db_schema: 'public,storage,graphql_public',
  db_extra_search_path: 'public,extensions',
  max_rows: 1000,
  db_pool: null, // auto-configured
};
