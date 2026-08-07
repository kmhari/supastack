/**
 * How a per-instance config field is delivered to its container (feature 124).
 *
 * SEC-065: a free-text config value written into the compose `.env` is expanded
 * by Compose's `${...}` substitution against the api's process environment,
 * which holds the master key. The fix routes each field by what it can carry:
 *
 *  - `raw`       — free-text, single-consumer. Delivered via the raw operator
 *                  env-file (no interpolation). The exploit surface; the value
 *                  reaches the container verbatim, so `${MASTER_KEY}` stays text.
 *  - `strict-env`— free-text but interpolated by a SECOND service, so it cannot
 *                  move without breaking that reference (db_schema,
 *                  db_extra_search_path — Postgres identifier lists, consumed by
 *                  more than one service). Stays in `.env`, but is strict-validated
 *                  (`assertSafeForEnv`) — schema identifiers legitimately never
 *                  contain `$`/quote/space, so rejection here is correct, unlike
 *                  for an SMTP password.
 *  - `env`       — type-constrained (boolean / number / duration / enum). Cannot
 *                  carry `${...}` past the API's own validation, so it is safe on
 *                  the interpolation path and keeps its template default. Unchanged.
 *
 * Channel is derived from the Zod schema shape, not a hand-list, so it cannot
 * drift as fields are added: a new `z.string()` field is `raw` automatically.
 */
import { UpdateAuthConfigBodySchema } from '@supastack/shared';
import { UpdatePostgrestConfigBodySchema } from '@supastack/shared';
import type { ZodTypeAny } from 'zod';

export type ConfigChannel = 'raw' | 'strict-env' | 'env';

/**
 * Free-text fields that a second service interpolates by their short key, so
 * they cannot move to the operator file without breaking that reference. They
 * stay in `.env` and are strict-validated instead. Keyed by API field name.
 */
const STRICT_MULTI_CONSUMER = new Set<string>(['db_schema', 'db_extra_search_path']);

/** Unwrap `.optional()` / `.nullable()` / `.default()` to the base Zod type. */
function baseType(t: ZodTypeAny): ZodTypeAny {
  let cur = t;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  while (cur && (cur as any)._def?.innerType) cur = (cur as any)._def.innerType;
  return cur;
}

function isFreeTextField(schema: ZodTypeAny | undefined): boolean {
  if (!schema) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (baseType(schema) as any)?._def?.typeName === 'ZodString';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AUTH_SHAPE = (UpdateAuthConfigBodySchema as any).shape ?? {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PGRST_SHAPE = (UpdatePostgrestConfigBodySchema as any).shape ?? {};

/**
 * Delivery channel for a honored field, given its API field name and the
 * config surface. A field the schema types as free-text (`z.string`) is a leak
 * vector and is routed away from interpolation; everything else stays.
 */
export function configChannel(fieldName: string, surface: string): ConfigChannel {
  const shape = surface === 'postgrest' ? PGRST_SHAPE : AUTH_SHAPE;
  if (!isFreeTextField(shape[fieldName])) return 'env';
  return STRICT_MULTI_CONSUMER.has(fieldName) ? 'strict-env' : 'raw';
}
