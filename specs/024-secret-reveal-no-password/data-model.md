# Data Model: Secret Reveal — No-Password UI Masking

**Branch**: `081-secret-reveal-no-password` | **Date**: 2026-05-25

---

## Existing Entities (unchanged)

### `instances` table
Stores per-project `encryptedSecrets` (bytea). The credentials reveal endpoint decrypts this blob. No schema change.

### `project_config_snapshots` table
Stores per-project encrypted auth config payloads (surface = `'auth'`). The new auth config reveal endpoint decrypts this blob. No schema change.

### `audit_log` table
Existing table. Reveal events are inserted by both endpoints. No schema change.

---

## Response Shapes

### Credentials Reveal Response (unchanged)
Returned by `POST /api/v1/instances/:ref/credentials/reveal`

```ts
interface CredentialsRevealResponse {
  ref: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
  postgresPassword: string;
  dashboardPassword: string;
  connectionStrings: {
    rest: string;
    auth: string;
    storage: string;
    directDb: string;
  };
}
```

### Auth Config Reveal Response (new)
Returned by `GET /api/v1/projects/:ref/config/auth/reveal`

The response is the plaintext auth config JSON — same shape as `GET /projects/:ref/config/auth` but with `SECRET_FIELDS` values **not** redacted. The `_supastack.fieldStatus` extension is omitted (not needed for reveal).

```ts
// Partial example — actual fields match the full auth config schema
interface AuthConfigRevealResponse {
  // Non-secret fields (same as GET)
  jwt_exp: number;
  disable_signup: boolean;
  external_email_enabled: boolean;
  // ... all other non-secret fields ...

  // Secret fields — returned as plaintext (not '***')
  external_github_secret: string | null;
  external_google_secret: string | null;
  external_discord_secret: string | null;
  // ... all other SECRET_FIELDS entries ...
}
```

---

## Audit Log Entries

### Credentials reveal (JWT/API keys)
```json
{
  "actorUserId": "<user-uuid>",
  "action": "secret.reveal",
  "targetKind": "instance",
  "targetId": "<project-ref>",
  "payload": null
}
```

### Auth config reveal (OAuth secrets)
```json
{
  "actorUserId": "<user-uuid>",
  "action": "secret.reveal",
  "targetKind": "instance",
  "targetId": "<project-ref>",
  "payload": { "surface": "auth" }
}
```

---

## Frontend State Shapes

### `useRevealCredentials` hook (simplified)
```ts
interface UseRevealCredentialsReturn {
  creds: Credentials | null;   // null until revealed
  reveal: () => Promise<void>; // triggers API call
  pending: boolean;
  error: string | null;
}
```

### OAuth form local state (per form component)
```ts
// Added to each of the 6 OAuth form components
const [revealed, setRevealed] = useState<boolean>(false);
const [revealing, setRevealing] = useState<boolean>(false);
// existing: const [secret, setSecret] = useState<string>('');
// After reveal: secret is populated with the plaintext value
```

---

## No Schema Migrations Required

This feature makes no changes to the PostgreSQL schema. All payload changes are limited to:
1. Backend: one new endpoint + one modified endpoint (no body parsing)
2. Frontend: state machine simplification and UI component updates
