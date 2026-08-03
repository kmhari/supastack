import { schema } from '@supastack/db';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres';
import { createHash, randomBytes } from 'node:crypto';

type Schema = typeof schema;
/** Accepts either the global db() or a transactional client. */
export type Inserter =
  | NodePgDatabase<Schema>
  | NodePgTransaction<Schema, ExtractTablesWithRelations<Schema>>;

/**
 * The exact regex the upstream Supabase CLI validates tokens against
 * client-side (`apps/cli-go/internal/utils/access_token.go:16`). Tokens
 * that do not match this pattern are rejected before any HTTP call is
 * made. Supastack only emits the `sbp_<40-hex>` form (no `oauth_` infix);
 * the regex here mirrors the CLI's so we can validate symmetrically.
 *
 * Spec: specs/003-supabase-cli-compat-p0/spec.md FR-003a
 */
export const PAT_FORMAT_REGEX = /^sbp_(oauth_)?[a-f0-9]{40}$/;

/** Random bytes behind the 40-hex suffix (160 bits of entropy). */
const TOKEN_ENTROPY_BYTES = 20;
/** Length of the display-only prefix stored in api_tokens.prefix. */
const TOKEN_PREFIX_LENGTH = 12; // `sbp_` (4) + 8 hex

/**
 * Generate the raw plaintext PAT. Pure function — exported for unit tests
 * that don't want to touch the DB.
 */
export function generateRawToken(): string {
  return `sbp_${randomBytes(TOKEN_ENTROPY_BYTES).toString('hex')}`;
}

/**
 * Display prefix: first 12 chars of plaintext (`sbp_` + 8 hex). Stored in
 * `api_tokens.prefix` so the dashboard's token list can render a stable
 * non-reversible label per token.
 */
export function formatTokenPrefix(raw: string): string {
  return raw.slice(0, TOKEN_PREFIX_LENGTH);
}

/**
 * Mint a fresh API token. Returns the raw token (shown ONCE to the caller)
 * and writes its SHA-256 hash + display prefix to the DB. Subsequent
 * lookups match against the hash; raw tokens never live in storage.
 *
 * Format: `sbp_<40 hex>` (44 chars). Constrained by the upstream Supabase
 * CLI's client-side regex (PAT_FORMAT_REGEX) — tokens that do not match
 * are rejected before any HTTP call is made.
 */
/**
 * Feature 122 — PAT lifetime bounds (FR-004/FR-012), operator-overridable.
 * `PAT_IDLE_MAX_DAYS` is enforced in the auth validation query, not here.
 */
export const PAT_ABSOLUTE_MAX_DAYS = intFromEnv('PAT_ABSOLUTE_MAX_DAYS', 365);
export const PAT_STUDIO_MAX_DAYS = intFromEnv('PAT_STUDIO_MAX_DAYS', 90);
export const PAT_IDLE_MAX_DAYS = intFromEnv('PAT_IDLE_MAX_DAYS', 90);

function intFromEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Absolute expiry for a newly-minted token: studio (human present) is shorter. */
export function patExpiryFor(source: 'manual' | 'cli' | 'studio', now = new Date()): Date {
  const days = source === 'studio' ? PAT_STUDIO_MAX_DAYS : PAT_ABSOLUTE_MAX_DAYS;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function mintApiToken(
  tx: Inserter,
  userId: string,
  label: string,
  source: 'manual' | 'cli' | 'studio' = 'manual',
): Promise<{ raw: string; id: string; prefix: string; expiresAt: Date }> {
  const raw = generateRawToken();
  const prefix = formatTokenPrefix(raw);
  const sha256 = createHash('sha256').update(raw, 'utf8').digest();
  const expiresAt = patExpiryFor(source);
  const [row] = await tx
    .insert(schema.apiTokens)
    .values({ userId, tokenSha256: sha256, label, prefix, source, expiresAt })
    .returning({ id: schema.apiTokens.id });
  return { raw, id: row!.id, prefix, expiresAt };
}
