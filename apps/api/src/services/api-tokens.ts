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

/** Warn window for the FR-013 `Sunset` header — how close to expiry to announce. */
export const PAT_SUNSET_WARN_DAYS = intFromEnv('PAT_SUNSET_WARN_DAYS', 30);

/**
 * FR-013 grace (Risk 2): idle expiry MUST NOT age out a dormant token during the
 * announced transition, or the "never silently invalidated" guarantee is void for
 * exactly the parked tokens the announcement exists for. An operator running the
 * backfill sets `PAT_IDLE_GRACE_UNTIL` to an ISO date ~90 days out; until then the
 * idle clause is skipped and only the absolute expiry applies. Absent/past/invalid
 * → idle enforced (the steady state).
 */
function intFromEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Whether the idle-expiry sub-clause applies now, given the FR-013 grace window. */
export function idleExpiryEnforced(now = new Date()): boolean {
  const raw = process.env.PAT_IDLE_GRACE_UNTIL;
  if (!raw) return true;
  const until = new Date(raw);
  if (Number.isNaN(until.getTime())) return true;
  return now.getTime() >= until.getTime();
}

/**
 * Feature 122 US2 (SEC-076) — clamp a requester-supplied data-plane key lifetime.
 * Absent → the platform default (`maxSec`); malformed/negative/non-integer →
 * refused (`ok:false`, NOT silently coerced — `parseInt('abc')` is NaN and would
 * otherwise flow into `iat + NaN`); above the max → clamped down. Pure function.
 */
export function clampDataPlaneExp(
  requested: string | undefined,
  maxSec: number,
): { ok: true; expSec: number; clamped: boolean } | { ok: false } {
  if (requested === undefined) return { ok: true, expSec: maxSec, clamped: false };
  const t = requested.trim();
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== t) return { ok: false };
  return { ok: true, expSec: Math.min(n, maxSec), clamped: n > maxSec };
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
