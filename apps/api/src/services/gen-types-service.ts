import {
  callPerInstanceMeta,
  PerInstanceMetaError,
  type InstanceRow,
} from './per-instance-meta.js';

/**
 * Service powering `GET /v1/projects/:ref/types/typescript` (feature 006 US1).
 *
 * Delegates to the per-instance `pg-meta` container via Kong. Forwards
 * pg-meta's TypeScript output unchanged — pg-meta is the same generator
 * Supabase Cloud uses, so we get byte-compat for free.
 */

export class GenTypesError extends Error {
  constructor(
    public readonly code:
      | 'schema_not_found'
      | 'instance_not_running'
      | 'meta_upstream_error'
      | 'meta_unreachable',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GenTypesError';
  }
}

/**
 * Generate TypeScript types for the given instance + schema set.
 * Returns the raw TypeScript source string.
 */
export async function generateTypes(inst: InstanceRow, schemas: string[]): Promise<string> {
  // Validate schemas exist via a cheap query through pg-meta. pg-meta
  // exposes /query for arbitrary SQL but we prefer /schemas for safety.
  const schemasResp = await callPerInstanceMetaSafe(inst, '/schemas');
  let availableSchemas: string[];
  try {
    const parsed = JSON.parse(schemasResp.body) as Array<{ name: string }>;
    availableSchemas = parsed.map((s) => s.name);
  } catch {
    availableSchemas = [];
  }
  const missing = schemas.filter((s) => !availableSchemas.includes(s));
  if (missing.length > 0) {
    throw new GenTypesError('schema_not_found', `Schema(s) not found: ${missing.join(', ')}`, {
      schemas_requested: schemas,
      schemas_available: availableSchemas,
      schemas_missing: missing,
    });
  }

  // pg-meta's /generators/typescript expects `included_schemas` as a single
  // comma-separated string (not repeated). Verified empirically: a repeated
  // form yields `request.query.included_schemas?.split is not a function`.
  const qs = new URLSearchParams();
  qs.set('included_schemas', schemas.join(','));
  const resp = await callPerInstanceMetaSafe(inst, `/generators/typescript?${qs.toString()}`);

  // pg-meta returns either a plain text TS source OR a JSON envelope like
  // { types: "..." } depending on its version. Normalize.
  try {
    const parsed = JSON.parse(resp.body) as { types?: string };
    if (typeof parsed.types === 'string') return parsed.types;
  } catch {
    /* not JSON */
  }
  return resp.body;
}

async function callPerInstanceMetaSafe(
  inst: InstanceRow,
  path: string,
): Promise<{ status: number; body: string }> {
  try {
    return await callPerInstanceMeta(inst, path);
  } catch (err) {
    if (err instanceof PerInstanceMetaError) {
      throw new GenTypesError(err.code, err.message);
    }
    throw err;
  }
}
