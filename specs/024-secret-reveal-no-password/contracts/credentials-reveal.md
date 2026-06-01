# Contract: Credentials Reveal Endpoint (Modified)

**Endpoint**: `POST /api/v1/instances/:ref/credentials/reveal`

**Change**: Body is no longer required. Password verification removed.

---

## Request

```
POST /api/v1/instances/:ref/credentials/reveal
Authorization: session cookie (required)
Content-Type: application/json (optional)
Body: {} or omitted
```

**Authentication**: Valid session cookie with admin role  
**Authorization**: `instance.reveal-credentials` RBAC action (admin-only, unchanged)

## Response — 200 OK

```json
{
  "ref": "zdhlmsaqdochwbkikqlv",
  "anonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "serviceRoleKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "jwtSecret": "super-secret-jwt-string",
  "postgresPassword": "strong-postgres-password",
  "dashboardPassword": "dashboard-admin-password",
  "connectionStrings": {
    "rest": "https://<ref>.<apex>/rest/v1/",
    "auth": "https://<ref>.<apex>/auth/v1/",
    "storage": "https://<ref>.<apex>/storage/v1/",
    "directDb": "postgres://postgres:<password>@127.0.0.1:<port>/postgres"
  }
}
```

## Error Responses

| Status | Code | When |
|--------|------|------|
| 401 | `unauthorized` | No valid session |
| 403 | `forbidden` | Session exists but role is not admin |
| 404 | `not_found` | Project ref does not exist or not accessible to caller |
| 500 | `internal_error` | Decryption failure or DB error |

## Removed Errors (no longer applicable)

- `401 reauth_required`: Password mismatch — **removed**

## Side Effects

- Inserts one row into `audit_log`: `action = 'secret.reveal'`, `targetKind = 'instance'`, `targetId = ref`

## Breaking Change Assessment

- **Body**: Previously required `{ "password": "..." }`. Now body is optional and ignored. Existing callers that send a body will still work (body is silently ignored).
- **Errors**: `reauth_required` 401 is no longer returned. Not a breaking change for callers — they will get fewer errors.
