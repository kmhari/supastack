# Data Model: Auth Providers Dashboard + Behavioral Parity

**Feature**: 020-auth-providers-dashboard | **Date**: 2026-05-28

No new database tables. All persistence reuses feature 009's `project_config_snapshots` row. This document captures the in-memory data shapes the feature introduces.

---

## 1. `AUTH_CONFIG_FIELD_STATUS` (TypeScript const)

**Location**: `apps/api/src/services/env-field-mapper.ts`

**Shape**:

```ts
export type FieldStatus =
  | { kind: 'honored'; envName: string; transform?: (v: unknown) => string; secret?: boolean }
  | { kind: 'stored_only'; reason: string }
  | { kind: 'unsupported'; reason: string };

export const AUTH_CONFIG_FIELD_STATUS: Record<string, FieldStatus>;
```

**Population**: exhaustive over `Object.keys(UpdateAuthConfigBodySchema.shape)`. 234 entries at current snapshot.

**Counts at merge time**:

| Status | Count | Examples |
|---|---:|---|
| `honored` | ≥ 160 (target 165, ± 5 tolerance — see research R-001) | `jwt_exp`, `site_url`, `external_google_secret`, `mailer_subjects_invite`, `rate_limit_email_sent`, `sessions_timebox`, `webauthn_rp_id` |
| `stored_only` | ~63 (some `mailer_*` may reclassify here if absent from pinned GoTrue image) | `sms_*` (#66), `hook_*` (#64), `mfa_*` (#65), `security_captcha_*` (#62), `saml_*` (#61) — `reason` field links to the tracking issue |
| `unsupported` | 6 | `oauth_server_*`, `nimbus_*`, `custom_oauth_enabled` — `reason: "Cloud-only OAuth server — see #63"` |

**Invariants**:
- Every `honored` entry has a non-empty `envName` matching the form `[A-Z_]+`.
- Every `stored_only` and `unsupported` entry has a `reason` ending with a GitHub-issue reference (e.g. "see #61").
- `secret: true` is set on every field whose value must be masked in GET (every `*_secret`, `*_auth_token`, `*_api_key`, `smtp_pass`).
- `Object.keys(AUTH_CONFIG_FIELD_STATUS)` equals `Object.keys(UpdateAuthConfigBodySchema.shape)` — enforced at build time by a `satisfies` const-assertion and at CI time by `upstream-auth-config-snapshot.test.ts`.

**Derived**:
- `AUTH_CONFIG_HONORED` (existing export, used by `runtime-config-store.applyEnvAndRestart`) — re-derived as `Object.fromEntries(entries.filter(e => e[1].kind === 'honored'))`.
- `lookupAuthFieldMapping(name)` — returns the entry directly; falls back to `{ kind: 'stored_only', reason: 'unclassified — build-test failure' }` only as a runtime safety net (the contract test prevents this in practice).

---

## 2. GET response augmentation

**Location**: `apps/api/src/services/runtime-config-store.ts:getConfig`

**Shape**: existing fields (the redacted `AuthConfigResponse`) plus a single new top-level key:

```jsonc
{
  // ─── existing upstream-shaped fields ────────────────────────────
  "jwt_exp": 3600,
  "site_url": "https://example.com",
  "external_google_enabled": true,
  "external_google_client_id": "...",
  "external_google_secret": null,  // masked
  // ... 230+ more fields per upstream UpdateAuthConfigBody ...

  // ─── supastack extension (new) ────────────────────────────────────
  "_supastack": {
    "fieldStatus": {
      "jwt_exp":            { "status": "honored",     "envName": "JWT_EXPIRY" },
      "external_google_secret": { "status": "honored", "envName": "GOOGLE_SECRET", "secret": true },
      "saml_enabled":       { "status": "stored_only", "reason": "no SAML infrastructure — see #61" },
      "oauth_server_enabled": { "status": "unsupported", "reason": "Cloud-only OAuth server — see #63" }
    }
  }
}
```

**Invariants**:
- The `_supastack` key is always present.
- `_supastack.fieldStatus` covers every field in `Object.keys(UpdateAuthConfigBody)` — no gaps, no extras.
- The CLI compatibility test asserts that stripping `_supastack` from the response yields a payload identical to what feature 009 returned pre-feature.

---

## 3. Provider registry (dashboard)

**Location**: `apps/web/src/pages/auth-providers/provider-registry.ts`

**Shape**:

```ts
type ProviderDef =
  | {
      key: string;                          // e.g. "google", "slack-oidc"
      displayName: string;                  // e.g. "Slack (OIDC)"
      icon: string;                         // import path or asset key
      status: 'active';
      formTemplate: 'CommonFour' | 'PlusUrl' | 'WorkOsShape' | 'Google' | 'Apple' | 'Oidc';
      fieldMap: Record<string, string>;     // form field name → auth-config field name
      docsUrl: string;                      // upstream docs URL for the provider
    }
  | {
      key: string;
      displayName: string;
      icon: string;
      status: 'coming-soon';
      comingSoonIssue: number;              // GitHub issue # for the tracking work
    };
```

**Count**: 26 entries — 21 active OAuth rows (20 unique providers + Slack OIDC second row) + Email + Phone + 3 coming-soon (SAML, Web3, Custom Providers). The 4 top-of-page toggles are NOT in the registry; they're rendered by `GlobalTogglesForm` directly. Note: `fly` and `snapchat` (which appear in Cloud's hosted dashboard) are NOT in the pinned upstream `UpdateAuthConfigBody` snapshot and are intentionally excluded from the registry.

**Special-case rows**:
- `key: 'email'`: status `active` but renders a toggle-only row (no drawer); `fieldMap: { enabled: 'external_email_enabled' }`.
- `key: 'phone'`: same; `fieldMap: { enabled: 'external_phone_enabled' }`.
- `key: 'slack'` (legacy): `displayName: 'Slack (Deprecated)'`, formTemplate `CommonFour`, fieldMap targets `external_slack_*`.
- `key: 'slack-oidc'`: `displayName: 'Slack (OIDC)'`, formTemplate `Oidc`, fieldMap targets `external_slack_oidc_*`.
- `key: 'saml'`: `status: 'coming-soon'`, `comingSoonIssue: 61`.
- `key: 'web3'`: `status: 'coming-soon'`, `comingSoonIssue: 72`.
- `key: 'custom-providers'`: rendered as a separate section (not a row in the providers list); same disabled-with-issue-link treatment, `comingSoonIssue: 63`.

---

## 4. Drawer state machine

**Location**: `apps/web/src/pages/ProjectAuthProviders.tsx`

```text
States:
  CLOSED
  OPEN_PRISTINE        — drawer rendered, form unmodified
  OPEN_DIRTY           — operator changed at least one field
  SAVING               — PATCH in flight
  RESTARTING           — PATCH succeeded; polling healthcheck
  SUCCESS              — toast flipped; row pill updated; drawer is CLOSED
  RESTART_FAILED       — toast shows Retry; drawer is CLOSED; row pill reverted

Transitions:
  CLOSED → OPEN_PRISTINE          via click on row OR ?provider=<Name> on page mount
  OPEN_PRISTINE → OPEN_DIRTY      via any input change
  OPEN_DIRTY → SAVING             via Save button
  SAVING → RESTARTING             on PATCH 200
  SAVING → OPEN_DIRTY             on PATCH 4xx/5xx (drawer stays open with error)
  RESTARTING → SUCCESS            on healthcheck pass within 60s
  RESTARTING → RESTART_FAILED     on healthcheck timeout OR `status==='errored'`
  RESTART_FAILED → SAVING         via Retry on the toast
  any state with drawer open → CLOSED  via Cancel / outside-click / ESC (with confirm prompt if DIRTY)
```

---

## 5. Behavioral-assertion dispatch table

**Location**: `tests/cli-e2e/helpers/auth-config-assertions.sh`

Bash-associative array (or `case` statement) keyed on auth-config field name. Each entry is a function name in the same file.

```text
declare -A ASSERTIONS=(
  [jwt_exp]=assert_jwt_exp
  [site_url]=assert_env_var_GOTRUE_SITE_URL
  [external_google_enabled]=assert_oauth_authorize_302
  [external_google_client_id]=assert_env_var_GOOGLE_CLIENT_ID
  [mailer_subjects_invite]=assert_mailer_subject_invite
  [rate_limit_email_sent]=assert_429_after_threshold
  [sessions_timebox]=assert_session_expires
  # ... 165 entries total ...
)
```

**Invariant** (enforced by `apps/api/tests/unit/env-field-mapper.test.ts`): `Object.keys(AUTH_CONFIG_FIELD_STATUS).filter(k => AUTH_CONFIG_FIELD_STATUS[k].kind === 'honored')` equals (as a set) `keys(ASSERTIONS)`.

---

## 6. Audit log entries

**No new event types.** All PATCH events use the existing `mgmt_api.auth_config.update` action emitted by `runtime-config-store.emitAudit` (feature 009). The diff body in the audit row already enumerates changed fields, so a "provider X enabled via dashboard" event is reconstructable from the existing `field` list. No data-model change needed.
