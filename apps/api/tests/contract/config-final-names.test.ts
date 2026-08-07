/**
 * Feature 124 — the short→final env-name table (config-final-names.ts) must
 * cover every honored field whose mapper `envName` is a short key.
 *
 * If a honored short key is missing from the table, the operator writer emits it
 * under its short name, GoTrue never reads it, and that tenant's SMTP / OAuth /
 * site-url silently stops working. This test makes that unexpressible: it derives
 * the honored short keys straight from the api mapper and asserts each resolves
 * to a final `GOTRUE_`/`PGRST_`/`API_` name.
 */
import { describe, expect, it } from 'vitest';
import { resolveFinalEnvName } from '@supastack/docker-control';
import { AUTH_CONFIG_HONORED, POSTGREST_CONFIG_MAP } from '../../src/services/env-field-mapper.js';

function honoredEnvNames(): string[] {
  const names: string[] = [];
  for (const m of Object.values(AUTH_CONFIG_HONORED)) {
    if (m.kind === 'honored') names.push(m.envName);
  }
  for (const m of Object.values(POSTGREST_CONFIG_MAP)) {
    if (m.kind === 'honored') names.push(m.envName);
  }
  return [...new Set(names)];
}

const FINAL_PREFIX = /^(GOTRUE_|PGRST_|API_)/;

describe('config-final-names covers every honored field', () => {
  it('resolves every honored envName to a final container name', () => {
    const unresolved: string[] = [];
    for (const envName of honoredEnvNames()) {
      const final = resolveFinalEnvName(envName);
      if (!FINAL_PREFIX.test(final)) unresolved.push(`${envName} -> ${final}`);
    }
    expect(
      unresolved,
      `these honored fields resolve to a non-final name — they would be delivered under a ` +
        `name GoTrue does not read, silently disabling the field:\n  ${unresolved.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the SMTP credential fields specifically resolve to GOTRUE_SMTP_*', () => {
    // These are the fields a naming miss hurts most — a tenant loses email.
    for (const short of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT']) {
      expect(resolveFinalEnvName(short)).toMatch(/^GOTRUE_SMTP_/);
    }
  });
});
