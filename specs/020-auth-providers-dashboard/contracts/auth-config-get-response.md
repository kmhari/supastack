# Contract: GET `/v1/projects/:ref/config/auth` response (post-feature 020)

**Feature**: 020-auth-providers-dashboard

This contract supersedes feature 009's `contracts/auth-config.md` for the GET response only. PATCH is unchanged.

---

## Response shape

```jsonc
{
  // ─── Every field in upstream UpdateAuthConfigBody (234 entries) ──────
  // Values are the current per-project setting, with secrets redacted.
  "jwt_exp": 3600,
  "site_url": "https://app.example.com",
  "uri_allow_list": "https://app.example.com,https://staging.example.com",
  "external_email_enabled": true,
  "external_google_enabled": true,
  "external_google_client_id": "1234.apps.googleusercontent.com",
  "external_google_secret": null,           // secret-typed → masked
  "external_google_additional_client_ids": null,
  "external_google_skip_nonce_check": false,
  "saml_enabled": false,
  "saml_external_url": null,
  // ... 222+ more fields ...

  // ─── Selfbase extension (new) ────────────────────────────────────────
  "_selfbase": {
    "fieldStatus": {
      // Every field in upstream UpdateAuthConfigBody is classified here.
      "jwt_exp": {
        "status": "honored",
        "envName": "JWT_EXPIRY"
      },
      "external_google_enabled": {
        "status": "honored",
        "envName": "GOOGLE_ENABLED"
      },
      "external_google_secret": {
        "status": "honored",
        "envName": "GOOGLE_SECRET",
        "secret": true
      },
      "saml_enabled": {
        "status": "stored_only",
        "reason": "no SAML keypair infrastructure — see #61"
      },
      "hook_custom_access_token_uri": {
        "status": "stored_only",
        "reason": "hook dispatcher not yet shipped — see #64"
      },
      "oauth_server_enabled": {
        "status": "unsupported",
        "reason": "Cloud-only OAuth authorization server — see #63"
      }
      // ... 228+ more entries ...
    }
  }
}
```

---

## Field-level status discriminator

| `status` value | Meaning | `envName` present | `reason` present | `secret` optional |
|---|---|:---:|:---:|:---:|
| `"honored"` | Value written to per-instance `.env`; container picks it up on next start. Changing this field changes runtime behavior. | yes | no | yes (true for `*_secret` etc.) |
| `"stored_only"` | Value persisted but not wired into the container. PATCH accepts it (CLI compat); changes are no-ops on the running auth surface. | no | yes (with `#NNN` issue ref) | no |
| `"unsupported"` | Selfbase has explicitly chosen never to honor. Same persistence as `stored_only`; the reason distinguishes intent. | no | yes (with `#NNN` issue ref) | no |

---

## Invariants

1. **Exhaustive classification**: `Object.keys(_selfbase.fieldStatus)` equals `Object.keys(UpdateAuthConfigBody.properties)` as a set. No gaps; no extras. Build-time enforced by `apps/api/tests/contract/upstream-auth-config-snapshot.test.ts`.

2. **CLI back-compat**: removing the `_selfbase` key from the response yields a payload byte-equivalent (modulo JSON key ordering) to what feature 009 returned pre-feature. The unmodified `supabase` CLI ignores unknown top-level keys; verified by a test that loads a captured pre-feature response, adds `_selfbase`, and parses via the same Zod schema the CLI uses.

3. **Secret masking**: every field whose `_selfbase.fieldStatus[field].secret === true` has its value field set to `null` in the response. The per-field secret value is never returned in this endpoint. A separate, audit-logged Reveal pathway (TBD in implementation; see `research.md` open items) is the only way to retrieve a plaintext secret value.

4. **Reason text format**: every `stored_only` and `unsupported` entry's `reason` string ends with a token of the form `#NNN` matching an open GitHub issue at merge time. Verified by a release-gate test that scrapes the strings and runs `gh issue view`.

5. **No version bump**: this is an additive response-shape change. The Management API surface version (currently `v1`) is unchanged. Upstream parity (Supabase Cloud) is unaffected — the `_selfbase` key has no analog there and is intentionally vendor-specific.

---

## Behavior unchanged

- HTTP method, URL path, status codes (200 / 401 / 403 / 404), RBAC action (`auth_config.read`), authentication mechanism (Bearer PAT or OAuth JWT) — all identical to feature 009.
- Project-state handling (paused projects return their last-known config) — unchanged.
- Concurrent-read safety — unchanged; reads are lock-free against `project_config_snapshots`.

---

## Test artifacts

- `apps/api/tests/unit/auth-config-response-shape.test.ts` — golden-file test of a known-good response with `_selfbase.fieldStatus` present.
- `apps/api/tests/contract/upstream-auth-config-snapshot.test.ts` — diff status-map keys against pinned snapshot keys.
- `tests/cli-e2e/cli-compat.sh` (existing) — augmented to verify `supabase config get` returns 0 against the new response.
