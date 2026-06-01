# Contract: Provider Form Templates

**Feature**: 020-auth-providers-dashboard

The Auth Providers page renders 25 rows. Each active row opens a side drawer; drawer contents are determined by the provider's `formTemplate`. This contract pins the exact field set per template + the auth-config-field mapping each form input writes to on Save.

---

## Templates at a glance

| Template | Providers (count) | Form fields |
|---|---|---|
| `CommonFour` | bitbucket, discord, facebook, figma, github, kakao, notion, spotify, twitch, twitter, x, zoom (12) | enable + client_id + secret + email_optional |
| `PlusUrl` | azure, gitlab, keycloak (3) | CommonFour + url |
| `WorkOsShape` | workos (1) | enable + client_id + secret + url (no email_optional) |
| `Google` | google (1) | CommonFour + additional_client_ids + skip_nonce_check |
| `Apple` | apple (1) | CommonFour + additional_client_ids |
| `Oidc` | linkedin, slack-oidc (2) | enable + client_id + secret + email_optional, all OIDC-prefixed |
| `LegacySlack` (CommonFour variant) | slack (1) | CommonFour mapped to legacy `external_slack_*` |
| (toggle-only, no template) | email, phone (2) | enable only |
| `GlobalToggles` (page-level) | (not a provider row) | 4 toggles + Save (see §7) |
| (coming-soon, no form) | saml, web3 (2 rows in providers list), custom-providers (1 separate section) | n/a |

Row math:
- Active OAuth rows: 12 (CommonFour) + 3 (PlusUrl) + 1 (WorkOsShape) + 1 (Google) + 1 (Apple) + 2 (Oidc) + 1 (LegacySlack) = **21 OAuth rows from 20 unique provider keys** (Slack contributes 2 rows — `slack` legacy + `slack-oidc`).
- Plus 2 toggle-only rows (email, phone).
- Plus 2 coming-soon rows inside the providers list (saml, web3).
- Plus 1 coming-soon "Custom Providers" section rendered below the list.
- **Total list rows: 25. Total page elements: 26** (25 list rows + 1 section).
- The 4 top-of-page toggles render via `GlobalTogglesForm` and are not counted as provider rows.

`fly` and `snapchat` (which appear in Cloud's hosted dashboard) are NOT in the pinned upstream `UpdateAuthConfigBody` snapshot — they have no form template and no row.

---

## §1. `CommonFour`

| Form input | Type | Auth-config field |
|---|---|---|
| Enable Sign in with {Provider} | toggle | `external_{key}_enabled` |
| Client ID | text | `external_{key}_client_id` |
| Client Secret | masked + Reveal | `external_{key}_secret` |
| Allow users without an email | toggle | `external_{key}_email_optional` |
| Callback URL (for OAuth) | read-only + Copy | (display only — `https://<ref>.<apex>/auth/v1/callback`) |

Validation:
- If `Enable Sign in` is on, Client ID + Client Secret are required (server-side validation from feature 009 enforces this; the drawer surfaces inline error on Save attempt).
- Client Secret field never displays a previously-saved secret; Reveal triggers a separate admin-only fetch.

---

## §2. `PlusUrl`

CommonFour plus:

| Form input | Type | Auth-config field |
|---|---|---|
| URL | text (URL) | `external_{key}_url` |

For `gitlab`, `keycloak`: the operator-hosted IdP base URL. For `azure`: the tenant URL.

---

## §3. `WorkOsShape`

| Form input | Type | Auth-config field |
|---|---|---|
| Enable Sign in with WorkOS | toggle | `external_workos_enabled` |
| Client ID | text | `external_workos_client_id` |
| Client Secret | masked + Reveal | `external_workos_secret` |
| URL | text (URL) | `external_workos_url` |
| Callback URL (for OAuth) | read-only + Copy | (display only) |

Note: NO `email_optional` toggle (drops the CommonFour 4th field).

---

## §4. `Google`

| Form input | Type | Auth-config field |
|---|---|---|
| Enable Sign in with Google | toggle | `external_google_enabled` |
| Client IDs | text (comma-separated) | `external_google_additional_client_ids` (concatenated with the primary `external_google_client_id`; see note) |
| Client Secret (for OAuth) | masked + Reveal | `external_google_secret` |
| Skip nonce checks | toggle | `external_google_skip_nonce_check` |
| Allow users without an email | toggle | `external_google_email_optional` |
| Callback URL (for OAuth) | read-only + Copy | (display only) |

Note: Cloud's "Client IDs" plural field is a comma-separated string of (Web client ID, Android client ID, One Tap client ID, …). supastack stores the primary in `external_google_client_id` and the rest in `external_google_additional_client_ids`. The drawer's single input writes the first value to `external_google_client_id` and the remainder to `external_google_additional_client_ids`. Read path reconstructs the comma-joined view.

---

## §5. `Apple`

| Form input | Type | Auth-config field |
|---|---|---|
| Enable Sign in with Apple | toggle | `external_apple_enabled` |
| Services ID | text | `external_apple_client_id` |
| Additional Services IDs | text (comma-separated) | `external_apple_additional_client_ids` |
| Client Secret (for OAuth) | masked + Reveal | `external_apple_secret` |
| Allow users without an email | toggle | `external_apple_email_optional` |
| Callback URL (for OAuth) | read-only + Copy | (display only) |

---

## §6. `Oidc`

Identical to `CommonFour` but all field names are `external_{key}_oidc_*`:

| Form input | Type | Auth-config field |
|---|---|---|
| Enable Sign in with {Provider} | toggle | `external_{key}_oidc_enabled` |
| Client ID | text | `external_{key}_oidc_client_id` |
| Client Secret | masked + Reveal | `external_{key}_oidc_secret` |
| Allow users without an email | toggle | `external_{key}_oidc_email_optional` |
| Callback URL (for OAuth) | read-only + Copy | (display only) |

Applies to: `linkedin`, `slack-oidc`.

---

## §7. `GlobalToggles` (top of page)

Rendered above the providers list with a single Save button governing the bundle.

| Form input | Type | Auth-config field | Notes |
|---|---|---|---|
| Allow new users to sign up | toggle | `disable_signup` | INVERTED — toggle ON means `disable_signup = false` |
| Allow manual linking | toggle | `security_manual_linking_enabled` | Newly honored in this feature (R-005) |
| Allow anonymous sign-ins | toggle | `external_anonymous_users_enabled` | |
| Confirm email | toggle | `mailer_autoconfirm` | INVERTED — toggle ON means `mailer_autoconfirm = false` (i.e. require confirmation) |

Save sends a single PATCH covering only the changed fields.

---

## Callback URL builder

For every drawer with a Callback URL field, the value displayed is:

```
https://<project.ref>.<control-plane.apex>/auth/v1/callback
```

- `<project.ref>` from the route param.
- `<control-plane.apex>` from the dashboard's existing project context (the same field used to build kong URLs elsewhere).

Read-only, never editable. Copy button uses `navigator.clipboard.writeText()`.

---

## Save semantics (per drawer)

1. Diff drawer form state vs. last-loaded auth-config to compute the change body.
2. Send `PATCH /v1/projects/<ref>/config/auth` with ONLY changed fields.
3. Close drawer immediately.
4. Trigger `useRestartToast(ref).save(changeBody)` — see plan §C4.
5. On success: toast flips, row pill updates via refetch.
6. On failure: toast flips to error + Retry; row pill reverts.

Cancel: discard drawer state, restore from last loaded snapshot, close.

ESC / outside-click while `OPEN_DIRTY`: prompt "Discard changes?" before closing.

---

## Coming-soon placeholders

The SAML, Web3 Wallet, and Custom Providers rows render via a separate `<ComingSoonRow />` component that:
- Shows the provider icon + name + status pill `"Coming soon"`.
- Is NOT clickable to open a drawer.
- The "Coming soon" badge links to the corresponding GitHub issue (`#61`, `#72`, `#63`).
- Has `aria-disabled` set on the row container for accessibility.
