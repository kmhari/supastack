# Phase 1 Data Model: Auth Config Studio parity

No persistent schema changes. This feature operates on **two views of the same field set** plus an in-memory translation. Entities below are logical (request/response shapes + the translation dictionary), not new tables.

## Entity: Auth config field

A single per-project auth setting. The same field appears under three names; only the first two are part of this feature's contract.

| Aspect | Value | Example |
|---|---|---|
| **Management API key** (canonical) | lowercase snake_case; the `env-field-mapper.ts` map key; what `UpdateAuthConfigBodySchema` validates | `external_github_enabled` |
| **Studio key** (dashboard) | UPPERCASE of the Management API key (modulo alias) | `EXTERNAL_GITHUB_ENABLED` |
| **GoTrue env var** (runtime, internal) | the mapper `envName`; NOT used for translation (inconsistent) | `GOTRUE_EXTERNAL_GITHUB_ENABLED` |
| **kind** | `honored` \| `stored_only` \| `unsupported` (from feature 020) | `honored` |
| **secret?** | whether the value is secret-masked on read | `external_github_secret` → yes |

**Invariant (translation contract)**: for every field, `studioKey.toLowerCase() === managementKey`, OR the pair is listed in the **alias table**. Verified by a self-maintaining test over the mapper's exported key set (R1).

## Entity: Translation dictionary

A pure, derived structure — not stored. Built once from the field-mapper key set.

- `MANAGEMENT_KEYS: Set<string>` — all valid lowercase keys (134 honored + stored_only/unsupported).
- `ALIASES: Record<studioKey, managementKey>` — explicit exceptions where `toLowerCase()` is wrong (expected to be empty or tiny; populated by the Phase-1 verification task).
- `toApiKeys(body)` → lower-cases each key (or applies alias); unknown keys pass through **unchanged** so the strict `/v1` schema reports them as `unknown_field`.
- `toStudioKeys(obj)` → upper-cases each config key (or reverse-alias); **excludes** meta keys (`_supastack`) from translation.

**Validation rules**:
- Partial payloads preserved: only keys present in the input are emitted (no key invented or dropped) (FR-006).
- Idempotent: `toStudioKeys(toApiKeys(x))` keys === `x` keys for all known fields (round-trip) (FR-003).
- Meta-safe: `_supastack` object passes through both directions untouched (R3).

## Entity: Auth hook config (subset view)

The `hook_*` slice of the auth config (feature 082), surfaced by `/config/hooks`.

| Hook | enabled flag | target | secrets |
|---|---|---|---|
| custom access token | `hook_custom_access_token_enabled` | `hook_custom_access_token_uri` | `hook_custom_access_token_secrets` |
| MFA verification attempt | `hook_mfa_verification_attempt_enabled` | `…_uri` | `…_secrets` |
| password verification attempt | `hook_password_verification_attempt_enabled` | `…_uri` | `…_secrets` |
| send SMS | `hook_send_sms_enabled` | `…_uri` | `…_secrets` |
| send email | `hook_send_email_enabled` | `…_uri` | `…_secrets` |
| before user created | `hook_before_user_created_enabled` | `…_uri` | `…_secrets` |
| after user created | `hook_after_user_created_enabled` | `…_uri` | `…_secrets` |

- **Read** (`GET /config/hooks`): project the hook_* fields out of the current auth config, upper-cased for Studio.
- **Write** (`PATCH /config/hooks`): translate + route through `patchConfig('auth', …)` (same store as `/config/auth`); secrets handled by the existing encrypted path (Constitution II). URI validation (pg-functions:// in Phase 1, feature 082) is reused, not re-implemented.

## State / flow

```
Studio (UPPERCASE) ──PATCH /platform/auth/:ref/config──▶ toApiKeys ──inject /v1/projects/:ref/config/auth──▶ patchConfig
                                                                                                              │
                                                                  apply env + GoTrue reload (existing) ◀──────┘
Studio (UPPERCASE) ◀──toStudioKeys──── /v1 response (lowercase + _supastack) ◀──GET /platform/auth/:ref/config
```

No state machine; each request is a stateless translate-and-forward. The only mutation is the existing per-instance `.env` + reload, unchanged by this feature.
