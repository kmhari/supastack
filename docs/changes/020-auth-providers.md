# Feature 020 — Auth Providers Dashboard + Behavioral Parity

**Closes**: #21 (revised, 141-field scope) and #34 (dashboard).
**Supersedes**: feature 019 (folded in).
**Spec**: [specs/020-auth-providers-dashboard/](../../specs/020-auth-providers-dashboard/)

This feature does two things, shipped together because they hard-depend on each other:

1. **Backend** — promotes 144 auth-config fields from "silently inert" to "actually wired into the per-instance GoTrue container". Honored-field count climbs from 24 to 169 (out of 234 total). `GET /v1/projects/<ref>/config/auth` now surfaces a `_selfbase.fieldStatus` extension that tells operators per-field whether a value will take effect.
2. **Dashboard** — new page at `Auth → Providers` mirroring [supabase.com/dashboard/.../auth/providers](https://supabase.com/dashboard). 21 OAuth provider drawers + Email/Phone toggle rows + 3 disabled "Coming soon" placeholders for things selfbase doesn't ship yet.

---

## Operator tour

Sidebar in any project shell: a new top-level **Authentication** group appears with one entry, **Providers**. Click in.

### Top of page — 4 global toggles

- **Allow new users to sign up** — inverts `disable_signup`. Off blocks all new signups.
- **Allow manual linking** — `security_manual_linking_enabled`. Lets identities be linked via the Auth admin API.
- **Allow anonymous sign-ins** — `external_anonymous_users_enabled`.
- **Confirm email** — inverts `mailer_autoconfirm`. On requires email confirmation before sign-in.

All four save via a single "Save changes" button, which triggers a ~30s GoTrue restart.

### Providers list (25 rows)

| Row | Behavior |
|---|---|
| Email | Toggle row (`external_email_enabled`) — flip + auto-save |
| Phone | Toggle row (`external_phone_enabled`) — same pattern |
| SAML 2.0 | Disabled, "Coming soon" → [#61](https://github.com/kmhari/selfbase/issues/61) |
| Web3 Wallet | Disabled, "Coming soon" → [#72](https://github.com/kmhari/selfbase/issues/72) |
| 21 OAuth providers (alphabetical) | Click → side drawer with provider-specific fields |

### Per-provider drawer

Each OAuth row opens a side drawer with fields specific to that provider's family:

| Provider family | Fields |
|---|---|
| **Google** | Enable + Client IDs (comma-joined Web/Android/One Tap IDs) + Client Secret + Skip nonce checks + Allow users without an email + Callback URL |
| **Apple** | Enable + **Services ID** + Additional Services IDs (comma-sep) + Client Secret + Allow users without an email + Callback URL |
| **Azure / GitLab / Keycloak** | CommonFour + a **URL field** (tenant URL / self-hosted GitLab URL / Keycloak realm URL) |
| **WorkOS** | Enable + Client ID + Secret + URL (no email_optional) |
| **LinkedIn / Slack (OIDC)** | OIDC-prefixed CommonFour — writes to `external_<key>_oidc_*` fields |
| **Slack (Deprecated)** | Legacy CommonFour writing to `external_slack_*`. Cloud-equivalent backward-compat row |
| **Everyone else (12)** | CommonFour: Enable + Client ID + Secret + Allow users without an email + Callback URL |

**The Callback URL field** is read-only and pre-filled with `https://<ref>.<apex>/auth/v1/callback`. Click "Copy" and paste it into the IdP console (e.g. Google Cloud Console → Credentials → Authorized redirect URIs).

**The Reveal button** on Client Secret is disabled. To update a saved secret, paste a new value and Save — leaving the field blank keeps the previous value. Plaintext readback of an existing secret is tracked in [#73](https://github.com/kmhari/selfbase/issues/73).

### After Save

1. Drawer closes immediately
2. Non-blocking toast appears: *"Restarting auth — your changes will be live in ~30s"*
3. Dashboard polls the per-instance container status with exponential backoff (500ms / 1s / 2s / 4s cap, max 60s)
4. On success: toast flips to *"Settings applied"*, the provider row's status pill flips Enabled
5. On failure: toast flips to error with a Retry button; the status pill reverts

---

## Per-provider IdP-side setup links

Operators bring their own OAuth credentials. Most-used IdPs:

| Provider | Where to get credentials |
|---|---|
| Google | [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) |
| GitHub | [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers) |
| Discord | [Discord Developer Portal](https://discord.com/developers/applications) |
| Apple | [Apple Developer → Identifiers → Services IDs](https://developer.apple.com/account/resources/identifiers/list/serviceId) |
| Azure | [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps) |
| Facebook | [Meta for Developers → Apps](https://developers.facebook.com/apps/) |
| GitLab | Your self-hosted instance → Admin → Applications |
| Keycloak | Your Keycloak admin → Realm → Clients |
| Slack | [Slack API → Your Apps](https://api.slack.com/apps) |
| WorkOS | [WorkOS Dashboard → Configuration](https://dashboard.workos.com/) |

For every other provider, the drawer's `Docs` link in the footer routes to Supabase's upstream guide.

---

## SRE / CLI: reading `_selfbase.fieldStatus`

The Management API surface gains a per-field status indicator visible to anyone with `auth_config.read`:

```bash
curl -sS -H "Authorization: Bearer $PAT" \
  "https://<apex>/v1/projects/<ref>/config/auth" | \
  jq '._selfbase.fieldStatus | to_entries[:5]'
```

```json
[
  { "key": "jwt_exp",                "value": { "status": "honored", "envName": "JWT_EXPIRY" } },
  { "key": "site_url",               "value": { "status": "honored", "envName": "SITE_URL" } },
  { "key": "uri_allow_list",         "value": { "status": "honored", "envName": "ADDITIONAL_REDIRECT_URLS" } },
  { "key": "disable_signup",         "value": { "status": "honored", "envName": "DISABLE_SIGNUP" } },
  { "key": "external_google_secret", "value": { "status": "honored", "envName": "GOOGLE_SECRET", "secret": true } }
]
```

Three statuses:

- **`honored`** — value flows to the per-instance .env on PATCH; GoTrue picks it up after the next restart.
- **`stored_only`** — value persisted but inert. The `reason` field links to a tracking issue (`#NNN`).
- **`unsupported`** — selfbase has deliberately chosen not to honor (Cloud-only OAuth server fields; see #63).

Field counts at merge time:

```bash
curl -sS -H "Authorization: Bearer $PAT" \
  "https://<apex>/v1/projects/<ref>/config/auth" | \
  jq '._selfbase.fieldStatus | [.[] | .status] | group_by(.) | map({status: .[0], count: length})'

# [
#   { "status": "honored",      "count": 169 },
#   { "status": "stored_only",  "count": 59 },
#   { "status": "unsupported",  "count": 6 }
# ]
```

CLI users (`supabase config get --auth`) work unchanged — the `_selfbase` key is silently ignored.

---

## Troubleshooting

**Sign in with Google redirects me to Google but lands back with an error.** Almost always a callback-URL mismatch. The URL registered in Google Cloud Console must match the dashboard's Callback URL field exactly (including the `<ref>.<apex>` host). Re-copy from the dashboard and paste into the IdP console.

**Toast says "Restart failed — try again".** The new env value caused GoTrue to refuse to start. Common causes:

- A `_url` field set to a non-URL value
- An OAuth `_secret` containing characters that break the .env format

Check the per-instance auth container logs:

```bash
ssh ubuntu@<vm-host> "sudo docker logs selfbase-<ref>-auth --tail 50"
```

Fix the offending value, retry.

**I configured Discord but `/auth/v1/authorize?provider=discord` still 400s.** Confirm Discord is honored:

```bash
curl -sS -H "Authorization: Bearer $PAT" \
  "https://<apex>/v1/projects/<ref>/config/auth" | \
  jq '._selfbase.fieldStatus.external_discord_enabled'
# { "status": "honored", "envName": "GOTRUE_EXTERNAL_DISCORD_ENABLED" }
```

If status is `stored_only` instead of `honored`, the env wiring didn't land — escalate as a feature 020 regression.

**Why is SAML/Web3/Custom Providers grayed out?** They're tracked in #61, #72, #63 respectively. Click the "Coming soon" badge to follow the GitHub issue.

**A non-admin operator can't see the Save buttons.** Expected — RBAC gates Save on `config.write`. Non-admins see status pills and field values (with secrets masked) but cannot mutate.

---

## What's NOT in this feature

- SMS provider configuration UI (Twilio/MessageBird/Textlocal/Vonage) — tracked in [#66](https://github.com/kmhari/selfbase/issues/66) (backend) + [#68](https://github.com/kmhari/selfbase/issues/68) (dashboard)
- Mailer template editor — backend promotes the 37 mailer fields here; dashboard page tracked in [#71](https://github.com/kmhari/selfbase/issues/71)
- MFA configuration UI — tracked in [#65](https://github.com/kmhari/selfbase/issues/65) (gated on a GoTrue image bump)
- Auth hooks (`hook_*`) — tracked in [#64](https://github.com/kmhari/selfbase/issues/64)
- Captcha env wiring — tracked in [#62](https://github.com/kmhari/selfbase/issues/62)
- SAML SSO support — tracked in [#61](https://github.com/kmhari/selfbase/issues/61)
- Web3 Wallet sign-in — tracked in [#72](https://github.com/kmhari/selfbase/issues/72)
- Custom OAuth server (selfbase as IdP) — tracked in [#63](https://github.com/kmhari/selfbase/issues/63), recommended to stay `unsupported`
- Migrating OAuth provider secrets into `vault.secrets` — tracked in [#70](https://github.com/kmhari/selfbase/issues/70)
- Plaintext reveal of an existing OAuth secret from the dashboard — tracked in [#73](https://github.com/kmhari/selfbase/issues/73)

---

## Behind the scenes

- **Single source of truth**: `apps/api/src/services/env-field-mapper.ts` `AUTH_CONFIG_FIELD_STATUS` — 234 entries, exhaustively classified.
- **Drift guard**: `apps/api/tests/contract/upstream-auth-config-snapshot.test.ts` fails the build if the upstream OpenAPI snapshot adds a field selfbase hasn't classified.
- **Behavioral parity test**: `tests/cli-e2e/auth-config-behavioral-parity.sh` runs PATCH → wait-healthy → assert for every honored field. Pattern-based dispatch (`jwt_exp`, `external_*_enabled` → OAuth authorize redirect, `rate_limit_email_sent` → 429 probe; fallback for everything else is env-var presence in the running container).
- **Coverage check**: `apps/api/tests/unit/env-field-mapper-coverage.test.ts` proves every honored field has an assertion path in the bash runner.

## Smoke verification (post-deploy)

See `specs/020-auth-providers-dashboard/quickstart.md` for 10 numbered smoke tests. Highlights:

1. Configure Google end-to-end from the dashboard, then complete a real OAuth handshake (Smoke 1)
2. Verify a freshly-promoted provider's env line lands in `.env` AND the running container (Smoke 2)
3. Verify the `_selfbase.fieldStatus` JSON shape via curl (Smoke 3)
4. Verify the unmodified `supabase` CLI still works (Smoke 4)
5. Run `tests/cli-e2e/auth-config-behavioral-parity.sh` (Smoke 10) — exits 0 within ~10 min on a healthy VM
