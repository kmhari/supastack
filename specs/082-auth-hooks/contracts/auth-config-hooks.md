# Contract: Auth Hooks — Auth Config Fields

**Endpoint**: `GET /v1/projects/:ref/config/auth` — field status extension

**Endpoint**: `PATCH /v1/projects/:ref/config/auth` — hook field write path

---

## GET /v1/projects/:ref/config/auth — `_supastack.fieldStatus` for hook fields

After this feature, all 21 `hook_*` fields MUST be classified as `honored` in the `_supastack.fieldStatus` extension.

```json
{
  "_supastack": {
    "fieldStatus": {
      "hook_custom_access_token_enabled": "honored",
      "hook_custom_access_token_uri":     "honored",
      "hook_custom_access_token_secrets": "honored",
      "hook_mfa_verification_attempt_enabled": "honored",
      "hook_mfa_verification_attempt_uri":     "honored",
      "hook_mfa_verification_attempt_secrets": "honored",
      "hook_password_verification_attempt_enabled": "honored",
      "hook_password_verification_attempt_uri":     "honored",
      "hook_password_verification_attempt_secrets": "honored",
      "hook_send_sms_enabled": "honored",
      "hook_send_sms_uri":     "honored",
      "hook_send_sms_secrets": "honored",
      "hook_send_email_enabled": "honored",
      "hook_send_email_uri":     "honored",
      "hook_send_email_secrets": "honored",
      "hook_before_user_created_enabled": "honored",
      "hook_before_user_created_uri":     "honored",
      "hook_before_user_created_secrets": "honored",
      "hook_after_user_created_enabled": "honored",
      "hook_after_user_created_uri":     "honored",
      "hook_after_user_created_secrets": "honored"
    }
  }
}
```

**Secret masking**: `hook_*_secrets` values MUST be returned as `"***"` in this endpoint. Use `GET /v1/projects/:ref/config/auth/reveal` for plaintext.

---

## PATCH /v1/projects/:ref/config/auth — hook field validation

### Valid request (pg-functions:// URI)

```json
PATCH /v1/projects/abc123/config/auth
{
  "hook_custom_access_token_enabled": true,
  "hook_custom_access_token_uri": "pg-functions://postgres/public/my_custom_jwt"
}
```

**Expected response**: `200 OK` with updated config. Container restarts; GoTrue dispatches the pg-functions hook on next JWT issue.

### Invalid request — HTTPS URI (Phase 2 deferred)

```json
PATCH /v1/projects/abc123/config/auth
{
  "hook_send_email_uri": "https://my-service.example.com/hook"
}
```

**Expected response**:
```json
HTTP 400 Bad Request
{
  "message": "HTTPS hook URIs are not yet supported. See issue #64 for progress.",
  "code": "hook_uri_scheme_unsupported",
  "details": { "field": "hook_send_email_uri" }
}
```

### Invalid request — unsupported scheme

```json
PATCH /v1/projects/abc123/config/auth
{
  "hook_custom_access_token_uri": "grpc://internal/my-hook"
}
```

**Expected response**:
```json
HTTP 400 Bad Request
{
  "message": "Hook URI scheme not supported. Only pg-functions:// is accepted (Phase 1). HTTPS support tracked in issue #64.",
  "code": "hook_uri_scheme_unsupported",
  "details": { "field": "hook_custom_access_token_uri" }
}
```

### Invalid request — enabled without URI

```json
PATCH /v1/projects/abc123/config/auth
{
  "hook_mfa_verification_attempt_enabled": true
}
```

(Assuming `hook_mfa_verification_attempt_uri` is currently null in stored config.)

**Expected response**:
```json
HTTP 400 Bad Request
{
  "message": "A URI is required when a hook is enabled.",
  "code": "hook_uri_required",
  "details": { "field": "hook_mfa_verification_attempt_uri" }
}
```

---

## Container env vars activated (Phase 1)

After a successful PATCH, the per-project `.env` file gains:

```env
GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true
GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/my_custom_jwt
```

(Secrets, if provided, appear as `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS=v1,whsec_...`)

Absent/null fields are **removed** from the env file (existing `removeEnvEntry` behaviour).
