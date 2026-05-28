// T047 — provider-registry structural assertions.
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_REGISTRY,
  findProviderByDisplayName,
} from '@/pages/auth-providers/provider-registry';

describe('PROVIDER_REGISTRY', () => {
  const toggle = PROVIDER_REGISTRY.filter((p) => p.kind === 'toggle-only');
  const oauth = PROVIDER_REGISTRY.filter((p) => p.kind === 'oauth');
  const comingSoon = PROVIDER_REGISTRY.filter((p) => p.kind === 'coming-soon');

  it('counts: 2 toggle-only + 21 oauth + 3 coming-soon = 26 entries', () => {
    expect(toggle.length).toBe(2);
    expect(oauth.length).toBe(21);
    expect(comingSoon.length).toBe(3);
    expect(PROVIDER_REGISTRY.length).toBe(26);
  });

  it('toggle-only entries are Email + Phone', () => {
    const keys = toggle.map((p) => p.key).sort();
    expect(keys).toEqual(['email', 'phone']);
  });

  it('OAuth registry covers the 20 unique upstream providers (Slack as 2 rows)', () => {
    const keys = oauth.map((p) => p.key).sort();
    expect(keys).toEqual(
      [
        'apple',
        'azure',
        'bitbucket',
        'discord',
        'facebook',
        'figma',
        'github',
        'gitlab',
        'google',
        'kakao',
        'keycloak',
        'linkedin',
        'notion',
        'slack',
        'slack-oidc',
        'spotify',
        'twitch',
        'twitter',
        'workos',
        'x',
        'zoom',
      ].sort(),
    );
  });

  it('every OAuth entry has the required form template', () => {
    for (const p of oauth) {
      expect(p.kind === 'oauth' && p.formTemplate).toBeTruthy();
      // Spot-check the family mappings.
      if (p.kind !== 'oauth') continue;
      if (['linkedin', 'slack-oidc'].includes(p.key)) {
        expect(p.formTemplate).toBe('Oidc');
      } else if (['azure', 'gitlab', 'keycloak'].includes(p.key)) {
        expect(p.formTemplate).toBe('PlusUrl');
      } else if (p.key === 'workos') {
        expect(p.formTemplate).toBe('WorkOsShape');
      } else if (p.key === 'google') {
        expect(p.formTemplate).toBe('Google');
      } else if (p.key === 'apple') {
        expect(p.formTemplate).toBe('Apple');
      } else {
        expect(p.formTemplate).toBe('CommonFour');
      }
    }
  });

  it('OIDC providers map to oidc_-prefixed auth-config fields', () => {
    const linkedin = oauth.find((p) => p.key === 'linkedin')!;
    const slackOidc = oauth.find((p) => p.key === 'slack-oidc')!;
    if (linkedin.kind === 'oauth') {
      expect(linkedin.fieldMap.enabled).toBe('external_linkedin_oidc_enabled');
      expect(linkedin.fieldMap.secret).toBe('external_linkedin_oidc_secret');
    }
    if (slackOidc.kind === 'oauth') {
      expect(slackOidc.fieldMap.enabled).toBe('external_slack_oidc_enabled');
    }
  });

  it('Slack legacy uses the non-OIDC field names', () => {
    const slackLegacy = oauth.find((p) => p.key === 'slack')!;
    if (slackLegacy.kind === 'oauth') {
      expect(slackLegacy.fieldMap.enabled).toBe('external_slack_enabled');
      expect(slackLegacy.displayName).toBe('Slack (Deprecated)');
    }
  });

  it('Apple has additional_client_ids in field map', () => {
    const apple = oauth.find((p) => p.key === 'apple')!;
    if (apple.kind === 'oauth') {
      expect(apple.fieldMap.additionalClientIds).toBe('external_apple_additional_client_ids');
    }
  });

  it('Google has additional_client_ids + skip_nonce_check in field map', () => {
    const google = oauth.find((p) => p.key === 'google')!;
    if (google.kind === 'oauth') {
      expect(google.fieldMap.additionalClientIds).toBe('external_google_additional_client_ids');
      expect(google.fieldMap.skipNonceCheck).toBe('external_google_skip_nonce_check');
    }
  });

  it('Plus-URL providers have url in field map', () => {
    for (const key of ['azure', 'gitlab', 'keycloak', 'workos']) {
      const p = oauth.find((o) => o.key === key)!;
      if (p.kind === 'oauth') {
        expect(p.fieldMap.url, `${key} should map url`).toBeTruthy();
      }
    }
  });

  it('coming-soon entries link to the right issues', () => {
    const saml = comingSoon.find((p) => p.key === 'saml')!;
    const web3 = comingSoon.find((p) => p.key === 'web3')!;
    const custom = comingSoon.find((p) => p.key === 'custom-providers')!;
    if (saml.kind === 'coming-soon') expect(saml.comingSoonIssue).toBe(61);
    if (web3.kind === 'coming-soon') expect(web3.comingSoonIssue).toBe(72);
    if (custom.kind === 'coming-soon') expect(custom.comingSoonIssue).toBe(63);
  });

  it('Custom Providers is placed as a separate section, not a list row', () => {
    const custom = comingSoon.find((p) => p.key === 'custom-providers')!;
    if (custom.kind === 'coming-soon') expect(custom.placement).toBe('section');
  });

  it('findProviderByDisplayName resolves case-insensitively', () => {
    expect(findProviderByDisplayName('Google')?.key).toBe('google');
    expect(findProviderByDisplayName('google')?.key).toBe('google');
    expect(findProviderByDisplayName('GOOGLE')?.key).toBe('google');
    expect(findProviderByDisplayName('Slack (OIDC)')?.key).toBe('slack-oidc');
    expect(findProviderByDisplayName('X / Twitter (OAuth 2.0)')?.key).toBe('x');
    expect(findProviderByDisplayName('not-a-provider')).toBeUndefined();
  });

  it('every OAuth entry has a non-empty docsUrl', () => {
    for (const p of oauth) {
      if (p.kind !== 'oauth') continue;
      expect(p.docsUrl).toMatch(/^https:\/\/supabase\.com\/docs\//);
    }
  });
});
