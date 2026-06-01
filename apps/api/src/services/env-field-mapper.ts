/**
 * Pure mapping table — upstream UpdateAuthConfigBody / UpdatePostgrestConfigBody
 * field name → corresponding env-var name in the per-instance .env, OR a marker
 * that the field is stored-only (persisted but not wired) or unsupported
 * (selfbase has explicitly chosen not to honor).
 *
 * Source of env var names: infra/supabase-template/docker-compose.yml.
 *
 * STRUCTURE (post-feature-020):
 *   - `AUTH_CONFIG_FIELD_STATUS` is the single source of truth: a 234-entry
 *     map keyed on every UpdateAuthConfigBody property, classifying each as
 *     honored / stored_only / unsupported with reason text for non-honored.
 *   - `AUTH_CONFIG_HONORED` is re-derived from it (back-compat re-export
 *     used by runtime-config-store.applyEnvAndRestart).
 *   - Coverage of all 234 fields is enforced by
 *     apps/api/tests/contract/upstream-auth-config-snapshot.test.ts which
 *     diffs the map keys against the upstream OpenAPI snapshot.
 *
 * Counts at merge time (target 165 ± 5; see feature 020 research R-001):
 *   - honored:     169
 *   - stored_only:  59
 *   - unsupported:   6
 *   - total:       234
 *
 * Spec: specs/020-auth-providers-dashboard/data-model.md §1
 */

import { ALL_AUTH_CONFIG_FIELDS } from '@supastack/shared';

// ─── Type definitions ──────────────────────────────────────────────────────

export type FieldStatus =
  | { kind: 'honored'; envName: string; transform?: (v: unknown) => string; secret?: boolean }
  | { kind: 'stored_only'; reason: string }
  | { kind: 'unsupported'; reason: string };

// Back-compat alias — runtime-config-store imports this name.
export type FieldMapping = FieldStatus;

// ─── Postgrest config (unchanged from feature 009) ─────────────────────────

export const POSTGREST_CONFIG_MAP: Record<string, FieldMapping> = {
  db_schema: { kind: 'honored', envName: 'PGRST_DB_SCHEMAS' },
  db_extra_search_path: { kind: 'honored', envName: 'PGRST_DB_EXTRA_SEARCH_PATH' },
  max_rows: { kind: 'honored', envName: 'PGRST_DB_MAX_ROWS' },
  db_pool: {
    kind: 'stored_only',
    reason: 'PGRST_DB_POOL not yet wired in template — tracked in #21',
  },
};

// ─── Transforms for non-scalar values ──────────────────────────────────────

/** Join arrays with commas (used by webauthn_rp_origins, sessions_tags). */
function joinComma(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(',');
  return String(v);
}

// ─── Auth-config: explicit honored entries — already-honored (feature 009 + T010a) ─

const ALREADY_HONORED: Record<string, FieldStatus> = {
  // Core (feature 009)
  jwt_exp: { kind: 'honored', envName: 'JWT_EXPIRY' },
  site_url: { kind: 'honored', envName: 'SITE_URL' },
  uri_allow_list: { kind: 'honored', envName: 'ADDITIONAL_REDIRECT_URLS' },
  disable_signup: { kind: 'honored', envName: 'DISABLE_SIGNUP' },
  // Foundational (T010a)
  security_manual_linking_enabled: {
    kind: 'honored',
    envName: 'SECURITY_MANUAL_LINKING_ENABLED',
  },
  // Email/Phone/Anonymous enable flags
  external_email_enabled: { kind: 'honored', envName: 'ENABLE_EMAIL_SIGNUP' },
  external_phone_enabled: { kind: 'honored', envName: 'ENABLE_PHONE_SIGNUP' },
  external_anonymous_users_enabled: { kind: 'honored', envName: 'ENABLE_ANONYMOUS_USERS' },
  // Autoconfirm
  mailer_autoconfirm: { kind: 'honored', envName: 'ENABLE_EMAIL_AUTOCONFIRM' },
  sms_autoconfirm: { kind: 'honored', envName: 'ENABLE_PHONE_AUTOCONFIRM' },
  // SMTP base
  smtp_admin_email: { kind: 'honored', envName: 'SMTP_ADMIN_EMAIL' },
  smtp_host: { kind: 'honored', envName: 'SMTP_HOST' },
  smtp_port: { kind: 'honored', envName: 'SMTP_PORT' },
  smtp_user: { kind: 'honored', envName: 'SMTP_USER' },
  smtp_pass: { kind: 'honored', envName: 'SMTP_PASS', secret: true },
  smtp_sender_name: { kind: 'honored', envName: 'SMTP_SENDER_NAME' },
  // OAuth: google/github/azure (3 providers × 3 fields — already wired in template)
  external_google_enabled: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_GOOGLE_ENABLED' },
  external_google_client_id: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID' },
  external_google_secret: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_GOOGLE_SECRET',
    secret: true,
  },
  external_github_enabled: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_GITHUB_ENABLED' },
  external_github_client_id: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_GITHUB_CLIENT_ID' },
  external_github_secret: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_GITHUB_SECRET',
    secret: true,
  },
  external_azure_enabled: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_AZURE_ENABLED' },
  external_azure_client_id: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_AZURE_CLIENT_ID' },
  external_azure_secret: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_AZURE_SECRET',
    secret: true,
  },
};

// ─── Auth-config: 17 newly-promoted OAuth providers + Slack OIDC + per-family extras (T023) ─
//
// Provider env names use the full GOTRUE_EXTERNAL_<UPPER>_* convention; the
// per-instance template T031 substitutes through `${VAR:-}` defaults so
// runtime-config-store writes the short alias and gotrue picks it up.

interface OAuthProviderConfig {
  hasEmailOptional?: boolean;
  hasUrl?: boolean;
  hasAdditionalClientIds?: boolean;
  hasSkipNonceCheck?: boolean;
  /** Use this prefix for env vars (e.g. 'SLACK_OIDC' instead of 'SLACK'). */
  envKey?: string;
}

const NEWLY_PROMOTED_OAUTH: Record<string, OAuthProviderConfig> = {
  apple: { hasEmailOptional: true, hasAdditionalClientIds: true },
  bitbucket: { hasEmailOptional: true },
  discord: { hasEmailOptional: true },
  facebook: { hasEmailOptional: true },
  figma: { hasEmailOptional: true },
  gitlab: { hasEmailOptional: true, hasUrl: true },
  kakao: { hasEmailOptional: true },
  keycloak: { hasEmailOptional: true, hasUrl: true },
  notion: { hasEmailOptional: true },
  spotify: { hasEmailOptional: true },
  twitch: { hasEmailOptional: true },
  twitter: { hasEmailOptional: true },
  workos: { hasUrl: true }, // no email_optional per contract §3
  x: { hasEmailOptional: true },
  zoom: { hasEmailOptional: true },
  slack: { hasEmailOptional: true }, // legacy Slack — `external_slack_*`
};

function newlyPromotedOauthEntries(): Record<string, FieldStatus> {
  const out: Record<string, FieldStatus> = {};
  for (const [provider, cfg] of Object.entries(NEWLY_PROMOTED_OAUTH)) {
    const upper = (cfg.envKey ?? provider).toUpperCase();
    out[`external_${provider}_enabled`] = {
      kind: 'honored',
      envName: `GOTRUE_EXTERNAL_${upper}_ENABLED`,
    };
    out[`external_${provider}_client_id`] = {
      kind: 'honored',
      envName: `GOTRUE_EXTERNAL_${upper}_CLIENT_ID`,
    };
    out[`external_${provider}_secret`] = {
      kind: 'honored',
      envName: `GOTRUE_EXTERNAL_${upper}_SECRET`,
      secret: true,
    };
    if (cfg.hasEmailOptional) {
      out[`external_${provider}_email_optional`] = {
        kind: 'honored',
        envName: `GOTRUE_EXTERNAL_${upper}_EMAIL_OPTIONAL`,
      };
    }
    if (cfg.hasUrl) {
      out[`external_${provider}_url`] = {
        kind: 'honored',
        envName: `GOTRUE_EXTERNAL_${upper}_URL`,
      };
    }
    if (cfg.hasAdditionalClientIds) {
      out[`external_${provider}_additional_client_ids`] = {
        kind: 'honored',
        envName: `GOTRUE_EXTERNAL_${upper}_ADDITIONAL_CLIENT_IDS`,
      };
    }
    if (cfg.hasSkipNonceCheck) {
      out[`external_${provider}_skip_nonce_check`] = {
        kind: 'honored',
        envName: `GOTRUE_EXTERNAL_${upper}_SKIP_NONCE_CHECK`,
      };
    }
  }
  return out;
}

// LinkedIn is OIDC-only (no legacy fields exist in upstream).
const LINKEDIN_OIDC_HONORED: Record<string, FieldStatus> = {
  external_linkedin_oidc_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_ENABLED',
  },
  external_linkedin_oidc_client_id: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_CLIENT_ID',
  },
  external_linkedin_oidc_secret: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_SECRET',
    secret: true,
  },
  external_linkedin_oidc_email_optional: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_LINKEDIN_OIDC_EMAIL_OPTIONAL',
  },
};

// Slack OIDC is a second row alongside the legacy `slack` provider.
const SLACK_OIDC_HONORED: Record<string, FieldStatus> = {
  external_slack_oidc_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_SLACK_OIDC_ENABLED',
  },
  external_slack_oidc_client_id: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_SLACK_OIDC_CLIENT_ID',
  },
  external_slack_oidc_secret: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_SLACK_OIDC_SECRET',
    secret: true,
  },
  external_slack_oidc_email_optional: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_SLACK_OIDC_EMAIL_OPTIONAL',
  },
};

// Google/Azure extras that aren't in the 3 already-honored fields (extras
// were stored_only before feature 020). Google: additional_client_ids,
// skip_nonce_check, email_optional. Azure: url, email_optional. GitHub:
// email_optional.
const ALREADY_HONORED_PROVIDER_EXTRAS: Record<string, FieldStatus> = {
  external_google_additional_client_ids: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_GOOGLE_ADDITIONAL_CLIENT_IDS',
  },
  external_google_skip_nonce_check: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK',
  },
  external_google_email_optional: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_GOOGLE_EMAIL_OPTIONAL',
  },
  external_azure_url: { kind: 'honored', envName: 'GOTRUE_EXTERNAL_AZURE_URL' },
  external_azure_email_optional: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_AZURE_EMAIL_OPTIONAL',
  },
  external_github_email_optional: {
    kind: 'honored',
    envName: 'GOTRUE_EXTERNAL_GITHUB_EMAIL_OPTIONAL',
  },
};

// ─── Mailer (T024) — 37 newly-promoted fields ──────────────────────────────

const MAILER_HONORED: Record<string, FieldStatus> = {
  // Notifications
  mailer_notifications_email_changed_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_NOTIFICATIONS_EMAIL_CHANGED_ENABLED',
  },
  mailer_notifications_identity_linked_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_NOTIFICATIONS_IDENTITY_LINKED_ENABLED',
  },
  mailer_notifications_identity_unlinked_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_NOTIFICATIONS_IDENTITY_UNLINKED_ENABLED',
  },
  mailer_notifications_mfa_factor_enrolled_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_NOTIFICATIONS_MFA_FACTOR_ENROLLED_ENABLED',
  },
  mailer_notifications_mfa_factor_unenrolled_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_NOTIFICATIONS_MFA_FACTOR_UNENROLLED_ENABLED',
  },
  mailer_notifications_password_changed_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_NOTIFICATIONS_PASSWORD_CHANGED_ENABLED',
  },
  mailer_notifications_phone_changed_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_NOTIFICATIONS_PHONE_CHANGED_ENABLED',
  },
  // OTP
  mailer_otp_exp: { kind: 'honored', envName: 'GOTRUE_MAILER_OTP_EXP' },
  mailer_otp_length: { kind: 'honored', envName: 'GOTRUE_MAILER_OTP_LENGTH' },
  // Misc
  mailer_allow_unverified_email_sign_ins: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_ALLOW_UNVERIFIED_EMAIL_SIGN_INS',
  },
  mailer_secure_email_change_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED',
  },
  // Subjects
  mailer_subjects_confirmation: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_CONFIRMATION',
  },
  mailer_subjects_email_change: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE',
  },
  mailer_subjects_email_changed_notification: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGED_NOTIFICATION',
  },
  mailer_subjects_identity_linked_notification: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_IDENTITY_LINKED_NOTIFICATION',
  },
  mailer_subjects_identity_unlinked_notification: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_IDENTITY_UNLINKED_NOTIFICATION',
  },
  mailer_subjects_invite: { kind: 'honored', envName: 'GOTRUE_MAILER_SUBJECTS_INVITE' },
  mailer_subjects_magic_link: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_MAGIC_LINK',
  },
  mailer_subjects_mfa_factor_enrolled_notification: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_MFA_FACTOR_ENROLLED_NOTIFICATION',
  },
  mailer_subjects_mfa_factor_unenrolled_notification: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_MFA_FACTOR_UNENROLLED_NOTIFICATION',
  },
  mailer_subjects_password_changed_notification: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_PASSWORD_CHANGED_NOTIFICATION',
  },
  mailer_subjects_phone_changed_notification: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_PHONE_CHANGED_NOTIFICATION',
  },
  mailer_subjects_reauthentication: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_SUBJECTS_REAUTHENTICATION',
  },
  mailer_subjects_recovery: { kind: 'honored', envName: 'GOTRUE_MAILER_SUBJECTS_RECOVERY' },
  // Templates (HTML content)
  mailer_templates_confirmation_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_CONFIRMATION_CONTENT',
  },
  mailer_templates_email_change_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE_CONTENT',
  },
  mailer_templates_email_changed_notification_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGED_NOTIFICATION_CONTENT',
  },
  mailer_templates_identity_linked_notification_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_IDENTITY_LINKED_NOTIFICATION_CONTENT',
  },
  mailer_templates_identity_unlinked_notification_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_IDENTITY_UNLINKED_NOTIFICATION_CONTENT',
  },
  mailer_templates_invite_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_INVITE_CONTENT',
  },
  mailer_templates_magic_link_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_MAGIC_LINK_CONTENT',
  },
  mailer_templates_mfa_factor_enrolled_notification_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_MFA_FACTOR_ENROLLED_NOTIFICATION_CONTENT',
  },
  mailer_templates_mfa_factor_unenrolled_notification_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_MFA_FACTOR_UNENROLLED_NOTIFICATION_CONTENT',
  },
  mailer_templates_password_changed_notification_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_PASSWORD_CHANGED_NOTIFICATION_CONTENT',
  },
  mailer_templates_phone_changed_notification_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_PHONE_CHANGED_NOTIFICATION_CONTENT',
  },
  mailer_templates_reauthentication_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_REAUTHENTICATION_CONTENT',
  },
  mailer_templates_recovery_content: {
    kind: 'honored',
    envName: 'GOTRUE_MAILER_TEMPLATES_RECOVERY_CONTENT',
  },
};

// ─── Sessions / password / webauthn-rp / passkey / api / db / smtp-misc (T025) — 19 fields ─

const SESSIONS_PW_ETC_HONORED: Record<string, FieldStatus> = {
  // Sessions — `sessions_timebox` and `sessions_inactivity_timeout` are
  // intentionally NOT honored: GoTrue rejects empty/zero durations, but
  // compose's `${VAR:-}` always emits an env line. Promotion blocked on
  // env_file: rework (#76). The other two session fields are safe.
  sessions_single_per_user: {
    kind: 'honored',
    envName: 'GOTRUE_SESSIONS_SINGLE_PER_USER',
  },
  sessions_tags: { kind: 'honored', envName: 'GOTRUE_SESSIONS_TAGS', transform: joinComma },
  // Password
  password_hibp_enabled: { kind: 'honored', envName: 'GOTRUE_PASSWORD_HIBP_ENABLED' },
  password_min_length: { kind: 'honored', envName: 'GOTRUE_PASSWORD_MIN_LENGTH' },
  password_required_characters: {
    kind: 'honored',
    envName: 'GOTRUE_PASSWORD_REQUIRED_CHARACTERS',
  },
  // WebAuthn relying-party identity
  webauthn_rp_display_name: {
    kind: 'honored',
    envName: 'GOTRUE_WEBAUTHN_RP_DISPLAY_NAME',
  },
  webauthn_rp_id: { kind: 'honored', envName: 'GOTRUE_WEBAUTHN_RP_ID' },
  webauthn_rp_origins: {
    kind: 'honored',
    envName: 'GOTRUE_WEBAUTHN_RP_ORIGINS',
    transform: joinComma,
  },
  // Passkey
  passkey_enabled: { kind: 'honored', envName: 'GOTRUE_PASSKEY_ENABLED' },
  // Refresh token
  refresh_token_rotation_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_REFRESH_TOKEN_ROTATION_ENABLED',
  },
  security_refresh_token_reuse_interval: {
    kind: 'honored',
    envName: 'GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL',
  },
  // API / DB / SMTP misc
  api_max_request_duration: { kind: 'honored', envName: 'GOTRUE_API_MAX_REQUEST_DURATION' },
  db_max_pool_size: { kind: 'honored', envName: 'GOTRUE_DB_MAX_POOL_SIZE' },
  db_max_pool_size_unit: { kind: 'honored', envName: 'GOTRUE_DB_MAX_POOL_SIZE_UNIT' },
  smtp_max_frequency: { kind: 'honored', envName: 'GOTRUE_SMTP_MAX_FREQUENCY' },
  security_sb_forwarded_for_enabled: {
    kind: 'honored',
    envName: 'GOTRUE_SECURITY_SB_FORWARDED_FOR_ENABLED',
  },
  security_update_password_require_reauthentication: {
    kind: 'honored',
    envName: 'GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION',
  },
};

// ─── Rate limits (T026) — 7 fields ─────────────────────────────────────────

const RATE_LIMIT_HONORED: Record<string, FieldStatus> = {
  rate_limit_anonymous_users: {
    kind: 'honored',
    envName: 'GOTRUE_RATE_LIMIT_ANONYMOUS_USERS',
  },
  rate_limit_email_sent: { kind: 'honored', envName: 'GOTRUE_RATE_LIMIT_EMAIL_SENT' },
  rate_limit_sms_sent: { kind: 'honored', envName: 'GOTRUE_RATE_LIMIT_SMS_SENT' },
  rate_limit_verify: { kind: 'honored', envName: 'GOTRUE_RATE_LIMIT_VERIFY' },
  rate_limit_token_refresh: {
    kind: 'honored',
    envName: 'GOTRUE_RATE_LIMIT_TOKEN_REFRESH',
  },
  rate_limit_otp: { kind: 'honored', envName: 'GOTRUE_RATE_LIMIT_OTP' },
  rate_limit_web3: { kind: 'honored', envName: 'GOTRUE_RATE_LIMIT_WEB3' },
};

// ─── Stored-only clusters (T027) — per-cluster reasons linking follow-up issues ─

const STORED_ONLY_REASONS: Record<string, string> = {};

const ADD_STORED = (prefix: string, reason: string): void => {
  for (const f of ALL_AUTH_CONFIG_FIELDS) {
    if (f.startsWith(prefix)) STORED_ONLY_REASONS[f] = reason;
  }
};
ADD_STORED('sms_', 'SMS providers — tracked in #66');
ADD_STORED('hook_', 'Auth hooks dispatcher — tracked in #64');
ADD_STORED('mfa_', 'MFA flags require GoTrue image bump — tracked in #65');
ADD_STORED('security_captcha_', 'Captcha env wiring — tracked in #62');
ADD_STORED('saml_', 'SAML SSO infrastructure — tracked in #61');
ADD_STORED('external_web3_', 'Web3 wallet sign-in — tracked in #72');
// sms_autoconfirm is actually honored — remove it from the stored_only set.
delete STORED_ONLY_REASONS['sms_autoconfirm'];

// Sessions duration fields can't be cleanly honored under compose `${VAR:-}` —
// GoTrue rejects both empty and zero durations. Honor blocked on env_file rework.
STORED_ONLY_REASONS['sessions_timebox'] =
  'GoTrue rejects empty/zero duration; needs env_file rework — tracked in #77';
STORED_ONLY_REASONS['sessions_inactivity_timeout'] =
  'GoTrue rejects empty/zero duration; needs env_file rework — tracked in #77';

// ─── Unsupported (T028) — Cloud-only OAuth server / Nimbus ─────────────────

const UNSUPPORTED_REASONS: Record<string, string> = {
  oauth_server_enabled: 'Cloud-only OAuth authorization server — see #63',
  oauth_server_allow_dynamic_registration: 'Cloud-only OAuth authorization server — see #63',
  oauth_server_authorization_path: 'Cloud-only OAuth authorization server — see #63',
  nimbus_oauth_client_id: 'Cloud-only Nimbus OAuth broker — see #63',
  nimbus_oauth_client_secret: 'Cloud-only Nimbus OAuth broker — see #63',
  custom_oauth_enabled: 'Cloud-only OAuth authorization server — see #63',
};

// ─── Build the full 234-entry status map ───────────────────────────────────

function buildFieldStatus(): Record<string, FieldStatus> {
  const explicitHonored: Record<string, FieldStatus> = {
    ...ALREADY_HONORED,
    ...newlyPromotedOauthEntries(),
    ...LINKEDIN_OIDC_HONORED,
    ...SLACK_OIDC_HONORED,
    ...ALREADY_HONORED_PROVIDER_EXTRAS,
    ...MAILER_HONORED,
    ...SESSIONS_PW_ETC_HONORED,
    ...RATE_LIMIT_HONORED,
  };

  const out: Record<string, FieldStatus> = {};
  for (const fieldName of ALL_AUTH_CONFIG_FIELDS) {
    if (fieldName in explicitHonored) {
      out[fieldName] = explicitHonored[fieldName]!;
    } else if (fieldName in UNSUPPORTED_REASONS) {
      out[fieldName] = { kind: 'unsupported', reason: UNSUPPORTED_REASONS[fieldName]! };
    } else if (fieldName in STORED_ONLY_REASONS) {
      out[fieldName] = { kind: 'stored_only', reason: STORED_ONLY_REASONS[fieldName]! };
    } else {
      // Any unclassified field is a bug — the contract test catches it at
      // build time. Use a clear runtime placeholder if it slips through.
      out[fieldName] = {
        kind: 'stored_only',
        reason: 'unclassified — see #21 build-test failure',
      };
    }
  }
  return out;
}

/**
 * The 234-entry source of truth. Every field in upstream's
 * UpdateAuthConfigBody is present and classified. Mutating this object after
 * module load is forbidden; use the readonly-cast accessor below.
 */
export const AUTH_CONFIG_FIELD_STATUS: Readonly<Record<string, FieldStatus>> =
  Object.freeze(buildFieldStatus());

/**
 * The honored subset, re-derived from AUTH_CONFIG_FIELD_STATUS. Used by
 * runtime-config-store.applyEnvAndRestart to enumerate fields whose values
 * need to land in the per-instance .env.
 */
export const AUTH_CONFIG_HONORED: Record<string, FieldMapping> = Object.fromEntries(
  Object.entries(AUTH_CONFIG_FIELD_STATUS).filter(([, v]) => v.kind === 'honored'),
);

/** Resolve a single auth-config field name to its mapping. */
export function lookupAuthFieldMapping(fieldName: string): FieldMapping {
  return (
    AUTH_CONFIG_FIELD_STATUS[fieldName] ?? {
      kind: 'stored_only',
      reason: 'unclassified — see #21 build-test failure',
    }
  );
}

/** Resolve a single postgrest-config field name to its mapping. */
export function lookupPostgrestFieldMapping(fieldName: string): FieldMapping {
  return (
    POSTGREST_CONFIG_MAP[fieldName] ?? {
      kind: 'stored_only',
      reason: 'unclassified — see #21 build-test failure',
    }
  );
}

/**
 * Turn a single field value into its env-line representation.
 * Booleans render as 'true' / 'false'. Numbers stringify. null/undefined
 * yields '' which the caller treats as "remove the env line."
 */
export function defaultEnvValueTransform(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}
