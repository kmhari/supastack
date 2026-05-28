/**
 * Provider definitions rendered on the Auth → Providers page.
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md FR-012, FR-014, FR-022
 * Data model: specs/020-auth-providers-dashboard/data-model.md §3
 * Contract:   specs/020-auth-providers-dashboard/contracts/provider-form-templates.md
 *
 * Tasks: T014 (Google + Email/Phone), T044 (all 21 OAuth rows + Slack OIDC),
 * T056 (SAML/Web3/Custom Providers coming-soon entries).
 */

export type FormTemplate = 'CommonFour' | 'PlusUrl' | 'WorkOsShape' | 'Google' | 'Apple' | 'Oidc';

export interface ToggleOnlyProvider {
  kind: 'toggle-only';
  key: string;
  displayName: string;
  /** Auth-config field that holds the enable flag. */
  enabledField: string;
}

export interface ActiveOAuthProvider {
  kind: 'oauth';
  key: string;
  displayName: string;
  formTemplate: FormTemplate;
  fieldMap: Record<string, string>;
  docsUrl: string;
}

export interface ComingSoonProvider {
  kind: 'coming-soon';
  key: string;
  displayName: string;
  comingSoonIssue: number;
  /** Where to render this entry in the page — inline in the list or as a separate section. */
  placement?: 'list' | 'section';
}

export type ProviderDef = ToggleOnlyProvider | ActiveOAuthProvider | ComingSoonProvider;

// ─── Helpers to declare field maps consistently ────────────────────────────

function commonFourMap(key: string): Record<string, string> {
  return {
    enabled: `external_${key}_enabled`,
    clientId: `external_${key}_client_id`,
    secret: `external_${key}_secret`,
    emailOptional: `external_${key}_email_optional`,
  };
}

function plusUrlMap(key: string): Record<string, string> {
  return {
    ...commonFourMap(key),
    url: `external_${key}_url`,
  };
}

function oidcMap(key: string): Record<string, string> {
  return {
    enabled: `external_${key}_oidc_enabled`,
    clientId: `external_${key}_oidc_client_id`,
    secret: `external_${key}_oidc_secret`,
    emailOptional: `external_${key}_oidc_email_optional`,
  };
}

// ─── Registry ──────────────────────────────────────────────────────────────

export const PROVIDER_REGISTRY: ProviderDef[] = [
  // ─── Email + Phone (toggle-only rows) ───────────────────────────────────
  {
    kind: 'toggle-only',
    key: 'email',
    displayName: 'Email',
    enabledField: 'external_email_enabled',
  },
  {
    kind: 'toggle-only',
    key: 'phone',
    displayName: 'Phone',
    enabledField: 'external_phone_enabled',
  },

  // ─── Coming-soon rows in the providers list (US5) ──────────────────────
  {
    kind: 'coming-soon',
    key: 'saml',
    displayName: 'SAML 2.0',
    comingSoonIssue: 61,
    placement: 'list',
  },
  {
    kind: 'coming-soon',
    key: 'web3',
    displayName: 'Web3 Wallet',
    comingSoonIssue: 72,
    placement: 'list',
  },

  // ─── OAuth providers (21 rows; alphabetical, Slack split into 2 rows) ───
  {
    kind: 'oauth',
    key: 'apple',
    displayName: 'Apple',
    formTemplate: 'Apple',
    fieldMap: {
      ...commonFourMap('apple'),
      additionalClientIds: 'external_apple_additional_client_ids',
    },
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-apple',
  },
  {
    kind: 'oauth',
    key: 'azure',
    displayName: 'Azure',
    formTemplate: 'PlusUrl',
    fieldMap: plusUrlMap('azure'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-azure',
  },
  {
    kind: 'oauth',
    key: 'bitbucket',
    displayName: 'Bitbucket',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('bitbucket'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-bitbucket',
  },
  {
    kind: 'oauth',
    key: 'discord',
    displayName: 'Discord',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('discord'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-discord',
  },
  {
    kind: 'oauth',
    key: 'facebook',
    displayName: 'Facebook',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('facebook'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-facebook',
  },
  {
    kind: 'oauth',
    key: 'figma',
    displayName: 'Figma',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('figma'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-figma',
  },
  {
    kind: 'oauth',
    key: 'github',
    displayName: 'GitHub',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('github'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-github',
  },
  {
    kind: 'oauth',
    key: 'gitlab',
    displayName: 'GitLab',
    formTemplate: 'PlusUrl',
    fieldMap: plusUrlMap('gitlab'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-gitlab',
  },
  {
    kind: 'oauth',
    key: 'google',
    displayName: 'Google',
    formTemplate: 'Google',
    fieldMap: {
      enabled: 'external_google_enabled',
      clientId: 'external_google_client_id',
      secret: 'external_google_secret',
      additionalClientIds: 'external_google_additional_client_ids',
      skipNonceCheck: 'external_google_skip_nonce_check',
      emailOptional: 'external_google_email_optional',
    },
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-google',
  },
  {
    kind: 'oauth',
    key: 'kakao',
    displayName: 'Kakao',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('kakao'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-kakao',
  },
  {
    kind: 'oauth',
    key: 'keycloak',
    displayName: 'Keycloak',
    formTemplate: 'PlusUrl',
    fieldMap: plusUrlMap('keycloak'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-keycloak',
  },
  {
    kind: 'oauth',
    key: 'linkedin',
    displayName: 'LinkedIn (OIDC)',
    formTemplate: 'Oidc',
    fieldMap: oidcMap('linkedin'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-linkedin',
  },
  {
    kind: 'oauth',
    key: 'notion',
    displayName: 'Notion',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('notion'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-notion',
  },
  {
    kind: 'oauth',
    key: 'slack-oidc',
    displayName: 'Slack (OIDC)',
    formTemplate: 'Oidc',
    fieldMap: oidcMap('slack'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-slack',
  },
  {
    kind: 'oauth',
    key: 'slack',
    displayName: 'Slack (Deprecated)',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('slack'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-slack',
  },
  {
    kind: 'oauth',
    key: 'spotify',
    displayName: 'Spotify',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('spotify'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-spotify',
  },
  {
    kind: 'oauth',
    key: 'twitch',
    displayName: 'Twitch',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('twitch'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-twitch',
  },
  {
    kind: 'oauth',
    key: 'twitter',
    displayName: 'Twitter (Deprecated)',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('twitter'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-twitter',
  },
  {
    kind: 'oauth',
    key: 'x',
    displayName: 'X / Twitter (OAuth 2.0)',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('x'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-twitter',
  },
  {
    kind: 'oauth',
    key: 'workos',
    displayName: 'WorkOS',
    formTemplate: 'WorkOsShape',
    fieldMap: {
      enabled: 'external_workos_enabled',
      clientId: 'external_workos_client_id',
      secret: 'external_workos_secret',
      url: 'external_workos_url',
    },
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-workos',
  },
  {
    kind: 'oauth',
    key: 'zoom',
    displayName: 'Zoom',
    formTemplate: 'CommonFour',
    fieldMap: commonFourMap('zoom'),
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-zoom',
  },

  // ─── Custom Providers (US5) — rendered as a separate section ────────────
  {
    kind: 'coming-soon',
    key: 'custom-providers',
    displayName: 'Custom Providers',
    comingSoonIssue: 63,
    placement: 'section',
  },
];

/** Look up a provider entry by case-insensitive display name (for ?provider=Google deep-links). */
export function findProviderByDisplayName(name: string): ProviderDef | undefined {
  const target = name.toLowerCase();
  return PROVIDER_REGISTRY.find((p) => p.displayName.toLowerCase() === target);
}
