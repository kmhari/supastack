/**
 * Feature 124 — the SEC-065 gate.
 *
 * Two invariants, both enforced against the actual template + schema:
 *  1. No free-text honored field is delivered on the interpolation path without
 *     protection. Every free-text field is either `raw` (operator file) or
 *     `strict-env` (assertSafeForEnv). A plain `env` free-text field is a leak.
 *  2. No `raw` field's final env name remains in the auth `environment:` block —
 *     a leftover line shadows the raw value (environment: wins over env_file),
 *     silently reopening the leak while looking fixed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { UpdateAuthConfigBodySchema } from '@supastack/shared';
import { resolveFinalEnvName } from '@supastack/docker-control';
import { configChannel } from '../../src/services/config-delivery.js';
import { AUTH_CONFIG_HONORED } from '../../src/services/env-field-mapper.js';

function repoFile(rel: string): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const c = path.join(dir, rel);
    if (existsSync(c)) return c;
    dir = path.dirname(dir);
  }
  throw new Error(`cannot locate ${rel}`);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const authShape = (UpdateAuthConfigBodySchema as any).shape as Record<string, z.ZodTypeAny>;
function isFreeText(field: string): boolean {
  let t: any = authShape[field];
  while (t?._def?.innerType) t = t._def.innerType;
  return t?._def?.typeName === 'ZodString';
}

const honoredAuth = Object.entries(AUTH_CONFIG_HONORED)
  .filter(([, m]) => m.kind === 'honored')
  .map(([field, m]) => ({ field, envName: (m as { envName: string }).envName }));

describe('every free-text honored field is protected (invariant 1)', () => {
  it('no free-text auth field is delivered as plain interpolated env', () => {
    const leaking = honoredAuth
      .filter(({ field }) => isFreeText(field))
      .filter(({ field }) => configChannel(field, 'auth') === 'env')
      .map(({ field }) => field);
    expect(
      leaking,
      `these free-text fields are on the interpolation path with no protection — ` +
        `a tenant could set them to \${MASTER_KEY}:\n  ${leaking.join('\n  ')}`,
    ).toEqual([]);
  });

  it('type-constrained fields stay on env (cannot carry the exploit)', () => {
    const jwtExp = honoredAuth.find((f) => f.field === 'jwt_exp')!;
    expect(configChannel(jwtExp.field, 'auth')).toBe('env');
  });
});

describe('no raw field remains in the auth environment: block (invariant 2)', () => {
  const tmpl = readFileSync(repoFile('infra/supabase-template/docker-compose.yml'), 'utf8');
  // the auth service environment: block — from `  auth:` to the next top-level service
  const authBlock = tmpl.slice(tmpl.indexOf('\n  auth:'), tmpl.indexOf('\n  rest:'));

  const rawFinalNames = honoredAuth
    .filter(({ field }) => configChannel(field, 'auth') === 'raw')
    .map(({ envName }) => resolveFinalEnvName(envName));

  it('has raw fields to check (guards the test itself)', () => {
    expect(rawFinalNames.length).toBeGreaterThan(50);
  });

  it.each(rawFinalNames)('%s is absent from auth environment:', (finalName) => {
    const re = new RegExp(`^      ${finalName}:`, 'm');
    expect(
      re.test(authBlock),
      `${finalName} is still in the auth environment: block — it shadows the raw ` +
        `operator value (environment: wins over env_file) and reopens SEC-065`,
    ).toBe(false);
  });

  it('the raw env_file entry is present in auth', () => {
    expect(authBlock).toMatch(/\.env\.operator/);
    expect(authBlock).toMatch(/format:\s*raw/);
  });
});
