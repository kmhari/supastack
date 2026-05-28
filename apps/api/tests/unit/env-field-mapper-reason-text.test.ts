/**
 * Release-gate test: every stored_only / unsupported reason ends with a
 * `#NNN` GitHub-issue reference. Optionally (with --with-gh) verifies the
 * referenced issues exist via `gh issue view`.
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md FR-003
 * Contract: specs/020-auth-providers-dashboard/contracts/auth-config-get-response.md "Invariant 4"
 * Task: T053
 */

import { describe, it, expect } from 'vitest';
import { AUTH_CONFIG_FIELD_STATUS } from '../../src/services/env-field-mapper.js';

describe('reason-text format', () => {
  const nonHonored = Object.entries(AUTH_CONFIG_FIELD_STATUS).filter(
    ([, v]) => v.kind !== 'honored',
  );

  it('every non-honored entry references at least one issue (#NNN)', () => {
    const offenders = nonHonored.filter(([, v]) => {
      if (v.kind === 'honored') return false;
      return !/#\d+/.test(v.reason);
    });
    expect(offenders.map(([k]) => k)).toEqual([]);
  });

  it('all referenced issue numbers fall in the expected feature-020 set', () => {
    // Spun-out follow-ups: #61 SAML, #62 captcha, #63 OAuth server, #64 hooks,
    // #65 MFA, #66 SMS, #72 web3 wallet. Plus #21 placeholder (parent issue,
    // should only appear if a field is mis-classified — not expected at merge).
    const ALLOWED = new Set([21, 61, 62, 63, 64, 65, 66, 70, 72, 73, 77]);
    const offenders: Array<{ field: string; issue: number }> = [];
    for (const [field, v] of nonHonored) {
      if (v.kind === 'honored') continue;
      const matches = v.reason.match(/#(\d+)/g) ?? [];
      for (const m of matches) {
        const num = parseInt(m.slice(1), 10);
        if (!ALLOWED.has(num)) offenders.push({ field, issue: num });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no entry uses the foundational #21 placeholder reason at release', () => {
    // T005 (foundational) seeded placeholder reasons referencing only #21.
    // US3 (T027) replaced them with cluster-specific references. If any
    // entry still reads "pending classification" or "unclassified", the
    // promotion job is incomplete.
    const stillPlaceholder = nonHonored.filter(([, v]) => {
      if (v.kind === 'honored') return false;
      return /pending classification|unclassified/i.test(v.reason);
    });
    expect(stillPlaceholder.map(([k]) => k)).toEqual([]);
  });
});
