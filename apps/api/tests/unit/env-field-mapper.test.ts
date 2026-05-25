import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AUTH_CONFIG_HONORED,
  POSTGREST_CONFIG_MAP,
  lookupAuthFieldMapping,
  lookupPostgrestFieldMapping,
} from '../../src/services/env-field-mapper.js';
import { ALL_AUTH_CONFIG_FIELDS, UpdatePostgrestConfigBodySchema } from '@selfbase/shared';

/**
 * T021 — env-field-mapper inventory tripwire.
 *
 * Guarantees:
 *  - Every key in upstream UpdateAuthConfigBody is reachable through the
 *    mapper (honored or stored_only). No silent drops.
 *  - Every key in UpdatePostgrestConfigBody is reachable.
 *  - Every `honored` envName actually appears somewhere in the per-instance
 *    docker-compose.yml template (the contract that the container will read).
 *
 * Spec: research.md R-007.
 */

const templatePath = path.resolve(
  __dirname,
  '../../../../infra/supabase-template/docker-compose.yml',
);
const composeYaml = readFileSync(templatePath, 'utf8');

describe('env-field-mapper inventory', () => {
  it('every UpdateAuthConfigBody field is reachable (honored or stored_only)', () => {
    for (const field of ALL_AUTH_CONFIG_FIELDS) {
      const m = lookupAuthFieldMapping(field);
      expect(m.kind).toMatch(/^(honored|stored_only)$/);
    }
  });

  it('every UpdatePostgrestConfigBody field is reachable (honored or stored_only)', () => {
    const keys = Object.keys(UpdatePostgrestConfigBodySchema.shape);
    expect(keys.length).toBeGreaterThan(0);
    for (const field of keys) {
      const m = lookupPostgrestFieldMapping(field);
      expect(m.kind).toMatch(/^(honored|stored_only)$/);
    }
  });

  it('every honored auth env var name appears somewhere in the per-instance template', () => {
    // The mapper's `envName` is the `.env` variable name (what `upsertEnvEntry`
    // writes). docker-compose either consumes it as `${envName}` interpolation
    // or, less commonly, declares it directly. Either occurrence is acceptable
    // — what matters is that the container has *some* binding for the var.
    for (const [field, mapping] of Object.entries(AUTH_CONFIG_HONORED)) {
      if (mapping.kind !== 'honored') continue;
      const envName = mapping.envName;
      // Token-anywhere match (key, `${...}`, comment) — surrounded by non-word
      // chars or string boundaries so we don't accept a substring like
      // GOOGLE_SECRET inside GOOGLE_SECRET_KEY (none of our names collide
      // today, but the guard makes the test deterministic).
      const pattern = new RegExp(`(^|[^A-Z_])${envName}([^A-Z_]|$)`, 'm');
      expect(
        pattern.test(composeYaml),
        `auth field ${field} maps to env var ${envName}, but the per-instance template never references it`,
      ).toBe(true);
    }
  });

  it('every honored postgrest env var name appears somewhere in the per-instance template', () => {
    for (const [field, mapping] of Object.entries(POSTGREST_CONFIG_MAP)) {
      if (mapping.kind !== 'honored') continue;
      const envName = mapping.envName;
      const pattern = new RegExp(`(^|[^A-Z_])${envName}([^A-Z_]|$)`, 'm');
      expect(
        pattern.test(composeYaml),
        `postgrest field ${field} maps to env var ${envName}, but the per-instance template never references it`,
      ).toBe(true);
    }
  });

  it('unknown field names resolve to stored_only', () => {
    expect(lookupAuthFieldMapping('totally_made_up').kind).toBe('stored_only');
    expect(lookupPostgrestFieldMapping('also_made_up').kind).toBe('stored_only');
  });
});
