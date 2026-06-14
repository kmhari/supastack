import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { UpdateAuthConfigBodySchema, UpdatePostgrestConfigBodySchema } from '@supastack/shared';
import type { ZodObject, ZodTypeAny } from 'zod';

/**
 * T022 — re-derive numeric bounds from the upstream OpenAPI snapshot and
 * assert the Zod schemas match. Catches upstream drift loudly.
 *
 * Spec: research.md R-006.
 */

const snapshotPath = path.resolve(
  __dirname,
  '../fixtures/upstream/openapi-snapshot-009-runtime-config.json',
);
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));

type FieldMeta = { type?: string; minimum?: number; maximum?: number };

function readBounds(schemaName: string): Record<string, FieldMeta> {
  return snapshot.components.schemas[schemaName].properties;
}

function zodNumericBounds(
  shape: ZodObject<Record<string, ZodTypeAny>>['shape'],
  field: string,
): { min?: number; max?: number } | null {
  const def = (shape as Record<string, ZodTypeAny>)[field];
  if (!def) return null;
  // Walk through .nullable().optional() to get to the inner ZodNumber.
  let inner: any = def;
  while (inner._def?.innerType) inner = inner._def.innerType;
  const checks = inner._def?.checks ?? [];
  const out: { min?: number; max?: number } = {};
  for (const c of checks) {
    if (c.kind === 'min') out.min = c.value;
    if (c.kind === 'max') out.max = c.value;
  }
  return out;
}

describe('Zod bounds match upstream OpenAPI', () => {
  describe('UpdatePostgrestConfigBody', () => {
    const upstream = readBounds('V1UpdatePostgrestConfigBody');
    const shape = UpdatePostgrestConfigBodySchema.shape;

    it.each(['max_rows', 'db_pool'])('field %s has matching min/max', (field) => {
      const u = upstream[field];
      expect(u, `field ${field} not present in upstream OpenAPI`).toBeDefined();
      const z = zodNumericBounds(shape, field);
      expect(z, `field ${field} not present in Zod`).not.toBeNull();
      expect(z!.min, `min mismatch on ${field}`).toBe(u!.minimum);
      expect(z!.max, `max mismatch on ${field}`).toBe(u!.maximum);
    });
  });

  describe('UpdateAuthConfigBody', () => {
    const upstream = readBounds('UpdateAuthConfigBody');
    const shape = UpdateAuthConfigBodySchema.shape;

    // Spot-check the load-bearing numeric fields cited in spec FR-005.
    it.each([
      'jwt_exp',
      'mailer_otp_exp',
      'sms_otp_exp',
      'mailer_otp_length',
      'password_min_length',
      'smtp_max_frequency',
      'sms_max_frequency',
      'mfa_phone_max_frequency',
    ])('field %s has matching min/max', (field) => {
      const u = upstream[field];
      expect(u, `field ${field} not present in upstream OpenAPI`).toBeDefined();
      const z = zodNumericBounds(shape, field);
      expect(z, `field ${field} not present in Zod`).not.toBeNull();
      expect(z!.min, `min mismatch on ${field}`).toBe(u!.minimum);
      expect(z!.max, `max mismatch on ${field}`).toBe(u!.maximum);
    });

    it('every upstream numeric field is present in the Zod schema with matching bounds', () => {
      const mismatches: string[] = [];
      for (const [field, meta] of Object.entries(upstream)) {
        if (meta.type !== 'integer' && meta.type !== 'number') continue;
        if (meta.minimum === undefined && meta.maximum === undefined) continue;
        const z = zodNumericBounds(shape, field);
        if (!z) {
          mismatches.push(`${field}: missing in Zod`);
          continue;
        }
        if (z.min !== meta.minimum) {
          mismatches.push(`${field}: min ${z.min} vs upstream ${meta.minimum}`);
        }
        if (z.max !== meta.maximum) {
          mismatches.push(`${field}: max ${z.max} vs upstream ${meta.maximum}`);
        }
      }
      expect(mismatches).toEqual([]);
    });
  });

  describe('strict mode rejects unknown fields', () => {
    it('postgrest: unknown field → ZodError', () => {
      const r = UpdatePostgrestConfigBodySchema.safeParse({ totally_unknown: 1 });
      expect(r.success).toBe(false);
    });
    it('auth: unknown field → ZodError', () => {
      const r = UpdateAuthConfigBodySchema.safeParse({ totally_unknown: 1 });
      expect(r.success).toBe(false);
    });
  });

  describe('bounds enforced', () => {
    it('postgrest: max_rows above ceiling rejected', () => {
      expect(UpdatePostgrestConfigBodySchema.safeParse({ max_rows: 2_000_000 }).success).toBe(
        false,
      );
    });
    it('postgrest: negative max_rows rejected', () => {
      expect(UpdatePostgrestConfigBodySchema.safeParse({ max_rows: -1 }).success).toBe(false);
    });
    it('auth: jwt_exp above 604800 rejected', () => {
      expect(UpdateAuthConfigBodySchema.safeParse({ jwt_exp: 700_000 }).success).toBe(false);
    });
    it('auth: jwt_exp at boundary accepted', () => {
      expect(UpdateAuthConfigBodySchema.safeParse({ jwt_exp: 604_800 }).success).toBe(true);
    });
  });
});
