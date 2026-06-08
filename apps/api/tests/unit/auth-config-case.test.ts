import { describe, expect, it } from 'vitest';
import { ALL_AUTH_CONFIG_FIELDS } from '@supastack/shared';
import { toApiKeys, toStudioKeys } from '../../src/services/auth-config-case.js';

describe('auth-config-case translation (feature 085)', () => {
  // T002: exhaustive proof that Studio↔API is a clean case-flip for EVERY field,
  // which is why the ALIASES table is empty. If a future schema field is not a
  // plain case-flip, this test fails → add an alias.
  it('exhaustive: every auth-config field round-trips via case-flip (no alias needed)', () => {
    const divergent: string[] = [];
    for (const apiKey of ALL_AUTH_CONFIG_FIELDS) {
      const studioKey = apiKey.toUpperCase();
      // Studio uppercase → api lowercase
      const back = toApiKeys({ [studioKey]: true });
      if (!(apiKey in back)) divergent.push(`${studioKey} !→ ${apiKey}`);
      // api lowercase → Studio uppercase
      const fwd = toStudioKeys({ [apiKey]: true });
      if (!(studioKey in fwd)) divergent.push(`${apiKey} !→ ${studioKey}`);
    }
    expect(divergent).toEqual([]);
    expect(ALL_AUTH_CONFIG_FIELDS.length).toBeGreaterThan(150);
  });

  it('happy: the reported GitHub payload lowercases correctly', () => {
    const out = toApiKeys({
      EXTERNAL_GITHUB_ENABLED: true,
      EXTERNAL_GITHUB_CLIENT_ID: 'id',
      EXTERNAL_GITHUB_SECRET: 'secret',
      EXTERNAL_GITHUB_EMAIL_OPTIONAL: false,
    });
    expect(out).toEqual({
      external_github_enabled: true,
      external_github_client_id: 'id',
      external_github_secret: 'secret',
      external_github_email_optional: false,
    });
  });

  it('happy: round-trip preserves the same set of fields', () => {
    const studio = { EXTERNAL_GITHUB_ENABLED: true, SITE_URL: 'https://x.test', JWT_EXP: 3600 };
    const round = toStudioKeys(toApiKeys(studio));
    expect(Object.keys(round).sort()).toEqual(Object.keys(studio).sort());
    expect(round.SITE_URL).toBe('https://x.test');
  });

  it('edge: the _supastack meta object passes through untouched in both directions', () => {
    const meta = { fieldStatus: { external_github_enabled: { status: 'honored' } } };
    expect(toStudioKeys({ external_github_enabled: true, _supastack: meta })).toEqual({
      EXTERNAL_GITHUB_ENABLED: true,
      _supastack: meta,
    });
    expect(toApiKeys({ EXTERNAL_GITHUB_ENABLED: true, _supastack: meta })).toEqual({
      external_github_enabled: true,
      _supastack: meta,
    });
  });

  it('edge: partial payload emits only its own keys (no field invented or dropped)', () => {
    expect(Object.keys(toApiKeys({ SITE_URL: 'x' }))).toEqual(['site_url']);
  });

  it('sad: an unknown field passes through UNCHANGED so the strict /v1 schema can reject it', () => {
    // Not silently lower-cased to a non-existent field — preserved verbatim for "unknown_field".
    expect(toApiKeys({ NONSENSE_FIELD_XYZ: 1 })).toEqual({ NONSENSE_FIELD_XYZ: 1 });
    expect(toStudioKeys({ some_unknown_lower: 1 })).toEqual({ some_unknown_lower: 1 });
  });
});
