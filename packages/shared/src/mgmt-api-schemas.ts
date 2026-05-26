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

// ─── CLI device-code login (feature 011) ────────────────────────────────────
// Wire shape is upstream-supabase-CLI-dictated. The CLI's Go struct
// AccessTokenResponse in apps/cli-go/internal/login/login.go expects exactly
// these field names + hex encoding. ANY drift breaks `supabase login`.

export const UuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const CliLoginMintRequestSchema = z.object({
  session_id: UuidV4,
  token_name: z.string().min(1).max(200),
  // 130 lowercase-hex chars beginning '04' = uncompressed SEC1 P-256 point
  public_key: z.string().length(130).regex(/^04[0-9a-f]{128}$/),
});
export type CliLoginMintRequest = z.infer<typeof CliLoginMintRequestSchema>;

export const CliLoginMintResponseSchema = z.object({
  device_code: z.string().length(8).regex(/^[0-9a-f]{8}$/),
});
export type CliLoginMintResponse = z.infer<typeof CliLoginMintResponseSchema>;

export const CliLoginResponseSchema = z.object({
  id: UuidV4,
  created_at: z.string().datetime(),
  // hex-encoded AES-256-GCM ciphertext concatenated with 16-byte auth tag
  access_token: z.string().regex(/^[0-9a-f]+$/),
  // hex-encoded uncompressed P-256 public key (server side)
  public_key: z.string().length(130).regex(/^04[0-9a-f]{128}$/),
  // hex-encoded 12-byte GCM nonce
  nonce: z.string().length(24).regex(/^[0-9a-f]{24}$/),
});
export type CliLoginResponse = z.infer<typeof CliLoginResponseSchema>;

// ─── CLI login-role (feature 012) ───────────────────────────────────────────
// Wire shape mirrors upstream `POST /v1/projects/{ref}/cli/login-role` and the
// matching DELETE on the same path. Snapshot:
//   specs/012-cli-login-role/contracts/upstream-openapi-snapshot.json
// Implemented by `cli-login-role.ts` in apps/api. The CLI's resolution path
// in `apps/cli-go/internal/utils/flags/db_url.go:123-180` calls this endpoint
// when no `--password` / `SUPABASE_DB_PASSWORD` is supplied; the upstream
// `AfterConnect` callback at `connect.go:215-220` runs `SET SESSION ROLE`
// based on the username's `cli_login_` prefix.

export const CreateLoginRoleBody = z
  .object({
    read_only: z.boolean(),
  })
  .strict(); // rejects extra fields with 400 + invalid_request
export type CreateLoginRoleBody = z.infer<typeof CreateLoginRoleBody>;

// Note: the `ttl_seconds` constraint `min(1)` mirrors upstream's OpenAPI
// `minimum: 1`; selfbase's runtime value is always TTL_SECONDS = 300
// (research.md Decision 2). Wire schema mirrors upstream's openapi minimum;
// selfbase always returns 300 — see TTL_SECONDS in cli-login-role-service.ts
// — so the looser-than-runtime constraint here isn't a sign that "TTL is
// configurable".
export const CreateLoginRoleResponse = z.object({
  role: z.string().min(1),
  password: z.string().min(1),
  ttl_seconds: z.number().int().min(1),
});
export type CreateLoginRoleResponse = z.infer<typeof CreateLoginRoleResponse>;

export const DeleteLoginRolesResponse = z.object({
  message: z.literal('ok'),
});
export type DeleteLoginRolesResponse = z.infer<typeof DeleteLoginRolesResponse>;
