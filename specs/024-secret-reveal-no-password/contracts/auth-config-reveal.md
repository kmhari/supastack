# Contract: Auth Config Reveal Endpoint (New)

**Endpoint**: `GET /api/v1/projects/:ref/config/auth/reveal`

**Purpose**: Return the full auth config for a project with OAuth client secrets unredacted, for use by the OAuth provider "Reveal" button in the dashboard.

---

## Request

```
GET /api/v1/projects/:ref/config/auth/reveal
Authorization: session cookie (required)
```

**Authentication**: Valid session cookie with admin role  
**Authorization**: `auth_config.read` RBAC action (admin-only, same as the standard GET)

## Response — 200 OK

Same shape as `GET /projects/:ref/config/auth` except:
- `SECRET_FIELDS` values are returned as their actual plaintext string (not redacted to `'***'`)
- Fields with no value remain `null`
- The `_supastack` extension object is **omitted** (not needed for reveal)

```json
{
  "jwt_exp": 3600,
  "disable_signup": false,
  "external_email_enabled": true,
  "external_github_enabled": true,
  "external_github_client_id": "abc123",
  "external_github_secret": "actual-plaintext-secret-here",
  "external_google_enabled": false,
  "external_google_client_id": null,
  "external_google_secret": null,
  "...": "all other auth config fields at their actual values"
}
```

## Error Responses

| Status | Code | When |
|--------|------|------|
| 401 | `unauthorized` | No valid session |
| 403 | `forbidden` | Session exists but role is not admin |
| 404 | `not_found` | Project ref not found or inaccessible |
| 500 | `internal_error` | Decryption failure or DB error |

## Side Effects

- Inserts one row into `audit_log`: `action = 'secret.reveal'`, `targetKind = 'instance'`, `targetId = ref`, `payload = { "surface": "auth" }`

## Frontend Usage

```ts
// apps/web/src/lib/api.ts — instancesApi
revealAuthConfig: (ref: string) =>
  unwrap<Record<string, unknown>>(client.get(`/projects/${ref}/config/auth/reveal`)),
```

OAuth form components call this on Reveal click and extract the field via `fm.secret!`:
```ts
const cfg = await instancesApi.revealAuthConfig(projectRef);
const val = cfg[fm.secret!] as string | null;
if (val && val !== '***') {
  setSecret(val);
  setRevealed(true);
}
```

## Notes

- This endpoint is registered under the `/api/v1` prefix in `apps/api/src/server.ts` (same registration as the standard auth config GET — `authConfigRoutes` is registered twice: once for dashboard under `/api/v1`, once for mgmt API under `/v1`).
- The route path `/projects/:ref/config/auth/reveal` is a child of the existing `/projects/:ref/config/auth` path and does not conflict with it.
