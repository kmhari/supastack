# Phase 1 Data Model — Platform Studio base=root + legacy studio reduced to /setup

**No database schema change. No migration.** This feature is URL/routing plumbing + SPA reduction + a service extraction over existing tables. The "entities" here are the URL surfaces, the shared org primitive, and the SPA file-set.

## A. URL surfaces (the behavioral entities)

| Surface | Before | After | Served by |
|---|---|---|---|
| Platform studio — platform calls | `/api/v1/platform/*` | `/platform/*` (apex) | `platformMiscRoutes` (now also mounted at root) + `platformProxyRoutes` (already at root) |
| Platform studio — Management-compat | `/api/v1/v1/*` (shim) | `/v1/*` (apex) | `/v1` mgmt scope + inline stubs (already at root) |
| CLI / MCP — Management-compat | `api.<apex>/v1/*` | unchanged | `/v1` mgmt scope (unchanged) |
| Operator login | `/auth/v1/*` (GoTrue) | unchanged | `auth:9999` via Caddy `/auth/v1/*` |
| Internal engine | `/api/v1/instances`, `/api/v1/instances/:ref/backups`, `/api/v1/audit`, … | retained | dashboard `/api/v1` mounts (the platform studio delegates into these via `app.inject`) |
| Install wizard | `/setup*` → `web:80` | unchanged | reduced apps/web SPA |

**Routing invariants** (Caddy ordering at the apex, most-specific first): `/.well-known/acme-challenge/*` → api; `/api/*` → api; **`/v1*` → api (NEW)**; `/platform/*` → api; `/auth/v1/*` → auth; websocket → api; `/internal/*` → api; `/setup*` → web; catch-all → studio. The new `/v1*` rule MUST precede the studio catch-all and MUST NOT shadow `/.well-known`, `/api/*`, or `/auth/v1/*`.

## B. Shared org-creation primitive (new service)

`apps/api/src/services/org-store.ts`:

```
createOrganizationWithOwner(tx, { userId, name }) → { id, name }
  id   = generateRef()                       // 20-char ref (feature 084 format)
  insert organizations { id, name }
  insert organization_members { organizationId: id, userId, role: 'owner' }
```

- **Input**: an `Inserter`/transaction handle (so callers control the transaction boundary), `userId` (a GoTrue `auth.users` id), `name` (trimmed, non-empty).
- **Validation**: `name` required + trimmed (the platform route returns 400 on empty; setup validates its `orgName` input upstream).
- **No authorization inside the primitive** — callers own authz (`POST /platform/organizations` = `requireAuth`; `setup.ts` = unauthenticated bootstrap gated by `setup_state`).
- **Idempotency**: the primitive is not self-idempotent (`generateRef` is fresh each call); single-execution is enforced by the caller (setup's `setup_state` gate; the platform route is a deliberate per-request create).

**Callers**:
- `POST /platform/organizations` (platform-misc.ts): `requireAuth` → validate → `db().transaction(tx => createOrganizationWithOwner(tx, {userId: user.id, name}))` → `buildOrg(...)` response (unchanged shape).
- `setup.ts`: inside the existing `db().transaction`, after the in-tx `setup_state` re-check, replace the inline org+member inserts (lines 48, 67-77) with `const { id: orgId } = await createOrganizationWithOwner(tx, { userId: operator.id, name: body.orgName })`. Installation/setup_state/audit/PAT/ownerless-backfill stay in setup.

## C. Existing tables touched (no schema change)

| Table | Used by | Change |
|---|---|---|
| `organizations` | org primitive | none (same insert) |
| `organization_members` | org primitive | none (same insert, `role:'owner'`) |
| `auth.users` (GoTrue) | setup user creation | none (already via `ensureGotrueUser`) |
| `installation` (singleton) | setup | none (stays setup-specific) |
| `setup_state` (singleton) | setup gate | none |
| `api_tokens` | setup master PAT | none |

## D. SPA file-set (apps/web reduction)

**Keep**: `pages/Setup.tsx`; `components/CopyButton.tsx` + `ui/{button,input,label,alert}.tsx`; `lib/{api.ts(trimmed),cli-wrapper.ts,auth-context.tsx,utils.ts}`; `main.tsx`, `App.tsx`(trimmed), `index.css`, `index.html`, `vite.config.ts`.

**`lib/api.ts` keep-set**: `setupApi`, `apexApi`, `wildcardCertApi`, `orgApi.patch`, `authApi.me` (+ backing types `ApexCert/ApexStatus/ChallengeRecord/DnsCheck/WildcardCert*`).

**Delete**: ~24 non-setup pages + dirs `auth-providers/`, `auth-url-config/`, `auth-hooks/`; page-only components (`ProjectShell`, `SettingsLayout`, `Shell`, `RequireAuth`, `SetupGate`, `LegacyProjectRedirect`, etc.); `lib/{safe-next,health-poll,use-reveal-credentials}.ts`; `lib/api.ts` groups `instancesApi/membersApi/authConfigApi/backupsApi/auditApi/cliApi/secretsApi/vaultApi/cliLoginApi/poolerApi/oauthApi` + the `authApi`/`orgApi` non-kept methods; the 8 page-bound unit tests; the Playwright e2e harness + `expected-pages.ts` + `check-page-coverage.mjs`.

## E. State transitions

None. No status enums, no lifecycle. The only "transition" is the one-time deploy cutover (old-base Studio + shim → new-base Studio + apex `/v1` routing), which is operational, not data.
