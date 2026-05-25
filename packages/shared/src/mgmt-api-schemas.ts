/**
 * Zod schemas mirroring the OpenAPI contract at
 *   specs/003-supabase-cli-compat-p0/contracts/management-api.yaml
 *
 * These are the shapes the upstream Supabase CLI's generated client expects
 * on the wire. Request schemas use `.passthrough()` (R-010 — permissive
 * parsing) so the CLI can add new optional fields without selfbase
 * regressing. Response schemas use strict `.object()` and emit only the
 * fields the CLI actually consumes — extra fields would be ignored by the
 * Go decoder anyway, but conservative output makes the contract clearer.
 *
 * Spec: specs/003-supabase-cli-compat-p0/spec.md FR-021, FR-022, FR-023
 */
import { z } from 'zod';

// ─── Token format (cross-referenced from api-tokens.ts) ────────────────────
export const PatFormat = z.string().regex(/^sbp_(oauth_)?[a-f0-9]{40}$/, {
  message: 'Token must be sbp_<40 hex>',
});

// ─── Function slug ─────────────────────────────────────────────────────────
export const FunctionSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, {
  message: 'Slug must be DNS-label-ish, lowercase, ≤48 chars',
});

// ─── Project ref ───────────────────────────────────────────────────────────
// Looser than the existing 20-char Ref in schemas.ts to accommodate the
// 20–32 char range allowed in the OpenAPI contract (existing selfbase refs
// are 20 chars; we keep the door open for longer in case requirements shift).
export const ManagementRef = z
  .string()
  .regex(/^[a-z0-9]{20,32}$/, '20–32 lowercase alphanumeric chars');

// ─── Error envelope (cloud-compatible) ─────────────────────────────────────
export const ErrorEnvelope = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

// ─── Profile (GET /v1/profile) ─────────────────────────────────────────────
export const ProfileSchema = z.object({
  id: z.string().uuid(),
  primary_email: z.string().email(),
  username: z.string().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;

// ─── Organization (GET /v1/organizations) ──────────────────────────────────
export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

// ─── Project (GET /v1/projects, GET /v1/projects/:ref) ─────────────────────
export const ProjectStatus = z.enum([
  'ACTIVE_HEALTHY',
  'COMING_UP',
  'INACTIVE',
  'RESTORING',
  'REMOVED',
  'UNKNOWN',
]);
export const ProjectSchema = z.object({
  id: z.string(),
  ref: z.string(),
  name: z.string(),
  organization_id: z.string(),
  region: z.string(),
  created_at: z.string(),
  status: ProjectStatus,
});
export type Project = z.infer<typeof ProjectSchema>;

// ─── API key (GET /v1/projects/:ref/api-keys) ──────────────────────────────
export const ApiKeyName = z.enum(['anon', 'service_role']);
export const ApiKeySchema = z.object({
  name: ApiKeyName,
  api_key: z.string(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

// ─── Function (Function* endpoints) ────────────────────────────────────────
export const FunctionStatus = z.enum(['ACTIVE', 'REMOVED', 'THROTTLED']);
export const FunctionSchema = z.object({
  id: z.string(),
  slug: FunctionSlug,
  name: z.string(),
  version: z.number().int().min(1),
  status: FunctionStatus,
  verify_jwt: z.boolean().optional(),
  import_map: z.boolean().optional(),
  entrypoint_path: z.string().nullable().optional(),
  import_map_path: z.string().nullable().optional(),
  ezbr_sha256: z.string().nullable().optional(),
  created_at: z.number().int().optional(), // epoch ms
  updated_at: z.number().int().optional(),
});
export type FunctionRecord = z.infer<typeof FunctionSchema>;

export const DeployFunctionResponseSchema = FunctionSchema;
export type DeployFunctionResponse = z.infer<typeof DeployFunctionResponseSchema>;

// ─── Function deploy metadata (the `metadata` multipart part) ──────────────
// Permissive — unknown fields ignored (FR-023).
export const FunctionDeployMetadataSchema = z
  .object({
    entrypoint_path: z.string(),
    import_map_path: z.string().optional(), // CLI sends "" when absent — kept as string
    name: z.string().optional(),
    static_patterns: z.array(z.string()).optional(),
    verify_jwt: z.boolean().optional(),
    sha256: z.string().optional(), // CLI only sets this on the eszip path
  })
  .passthrough();
export type FunctionDeployMetadata = z.infer<typeof FunctionDeployMetadataSchema>;

// ─── Eszip-path query metadata (POST /v1/projects/:ref/functions?...) ──────
// All values arrive as strings from the URL. Coerce booleans/sha-hex.
export const EszipDeployQuerySchema = z
  .object({
    slug: FunctionSlug,
    name: z.string().optional(),
    verify_jwt: z
      .preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean())
      .optional(),
    import_map_path: z.string().optional(),
    entrypoint_path: z.string().optional(),
    ezbr_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, 'sha256 hex')
      .optional(),
  })
  .passthrough();
export type EszipDeployQuery = z.infer<typeof EszipDeployQuerySchema>;

// PATCH variant — slug comes from the URL path, not the query.
export const EszipUpdateQuerySchema = EszipDeployQuerySchema.omit({ slug: true, name: true });
export type EszipUpdateQuery = z.infer<typeof EszipUpdateQuerySchema>;

// ─── Bulk update (PUT /v1/projects/:ref/functions) ─────────────────────────
export const BulkUpdateFunctionEntrySchema = FunctionSchema;
export type BulkUpdateFunctionEntry = z.infer<typeof BulkUpdateFunctionEntrySchema>;
export const BulkUpdateFunctionBodySchema = z.array(BulkUpdateFunctionEntrySchema);
export const BulkUpdateFunctionResponseSchema = z.object({
  functions: z.array(FunctionSchema),
});

// ─── Secrets (GET/POST/DELETE /v1/projects/:ref/secrets) ───────────────────
export const SecretNameFormat = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'POSIX env name: uppercase, ≤64, must start with letter');

export const SecretInputSchema = z
  .object({
    name: SecretNameFormat,
    value: z.string(),
  })
  .passthrough();
export const SecretSetBodySchema = z.array(SecretInputSchema);
export type SecretInput = z.infer<typeof SecretInputSchema>;

export const SecretListEntrySchema = z.object({
  name: z.string(),
  value: z.string(), // redacted: sha256 hex digest of the plaintext
});
export type SecretListEntry = z.infer<typeof SecretListEntrySchema>;

export const SecretDeleteBodySchema = z.array(SecretNameFormat);
