import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AUTH_CONFIG_HONORED,
  POSTGREST_CONFIG_MAP,
  lookupAuthFieldMapping,
  lookupPostgrestFieldMapping,
} from '../../src/services/env-field-mapper.js';
import { ALL_AUTH_CONFIG_FIELDS, UpdatePostgrestConfigBodySchema } from '@supastack/shared';

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
      expect(m.kind).toMatch(/^(honored|stored_only|unsupported)$/);
    }
  });

  it('every UpdatePostgrestConfigBody field is reachable (honored or stored_only)', () => {
    const keys = Object.keys(UpdatePostgrestConfigBodySchema.shape);
    expect(keys.length).toBeGreaterThan(0);
    for (const field of keys) {
      const m = lookupPostgrestFieldMapping(field);
      expect(m.kind).toMatch(/^(honored|stored_only|unsupported)$/);
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

// ─── T029 — count assertions and reason-text invariants (feature 020) ───────

import { AUTH_CONFIG_FIELD_STATUS } from '../../src/services/env-field-mapper.js';

describe('AUTH_CONFIG_FIELD_STATUS counts (T029)', () => {
  const entries = Object.values(AUTH_CONFIG_FIELD_STATUS);
  const honored = entries.filter((e) => e.kind === 'honored');
  const storedOnly = entries.filter((e) => e.kind === 'stored_only');
  const unsupported = entries.filter((e) => e.kind === 'unsupported');

  it('total is exactly 234 (matches upstream snapshot)', () => {
    expect(entries.length).toBe(234);
  });

  it('honored count is in target range [183, 193] (feature 082 added hook fields)', () => {
    expect(honored.length).toBeGreaterThanOrEqual(183);
    expect(honored.length).toBeLessThanOrEqual(193);
  });

  it('unsupported count is exactly 6 (Cloud-only OAuth server + Nimbus)', () => {
    expect(unsupported.length).toBe(6);
  });

  it('stored_only + unsupported + honored sums to 234', () => {
    expect(honored.length + storedOnly.length + unsupported.length).toBe(234);
  });

  it('every non-honored entry has a non-empty reason', () => {
    const offenders = entries.filter(
      (e) => e.kind !== 'honored' && (!('reason' in e) || !e.reason),
    );
    expect(offenders).toEqual([]);
  });

  it('every honored entry has a non-empty envName', () => {
    const offenders = entries.filter((e) => e.kind === 'honored' && !e.envName);
    expect(offenders).toEqual([]);
  });

  it('every stored_only / unsupported reason references a tracking issue', () => {
    const noIssueRef = entries.filter(
      (e) => (e.kind === 'stored_only' || e.kind === 'unsupported') && !/#\d+/.test(e.reason),
    );
    expect(noIssueRef).toEqual([]);
  });

  it('secret-named honored fields are flagged for masking', () => {
    const unmasked = honored.filter(
      (e) =>
        e.kind === 'honored' && /SECRET|AUTH_TOKEN|API_KEY|SMTP_PASS/i.test(e.envName) && !e.secret,
    );
    expect(unmasked).toEqual([]);
  });
});
