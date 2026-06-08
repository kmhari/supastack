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

US1–US3: none. The cutover is operational. **US6 introduces a data-backed transition** (below).

## F. Setup-completion gate (US5)

- **Signal**: `setup_state.completed_at` (existing singleton; no new column). `NULL` → gated; non-null → studio.
- **Gate route**: edge-only — `caddy-config.ts` emits a 302→`/setup` catch-all when `completed_at IS NULL`, else the `studio:3000` catch-all. Boot `Caddyfile` defaults gated. No DB schema change.
- **Transition**: setup completion writes `completed_at` and triggers `reloadCaddy()` → the gate route is replaced by the studio catch-all (one-way; setup is one-time/gated).

## G. Backups (US6) — migration + entities

**Migration (new, idempotent)**: `backups` gains a `seq bigint` numeric surrogate (identity/sequence-backed, `ADD COLUMN IF NOT EXISTS`). Native `id uuid` is unchanged (CLI/`/v1` contract).

| Entity | Source | Studio-facing shape |
|---|---|---|
| **Backup (list item)** | `backups` row (`seq`, `status`, `startedAt`, `instanceRef`) | `{ isPhysicalBackup:true, id:seq(number), inserted_at:ISO, status:UPPERCASE, project_id:int }` |
| **Backups envelope** | per-project | `{ region:'local', pitr_enabled:false, walg_enabled:false, backups[], physicalBackupData:{earliest/latestPhysicalBackupDateUnix} }` |
| **Restore** | `restore_jobs` + `selfbase.restore` queue + `handleRestore` worker | `POST /restore-physical {id:seq}` → resolve seq→uuid → `initiateRestore` → 201 |
| **Project status** | `supabase_instances.status` | `GET /platform/projects/:ref/status` → `running→ACTIVE_HEALTHY`, `restoring→RESTORING`, else `UPPER(status)` |

**State transition (restore)**: `supabase_instances.status`: `running` → (`initiateRestore`, in-tx) `restoring` → (`handleRestore` success) `running` / (failure) `running`|`failed`. The studio polls `/platform/projects/:ref/status` to observe `RESTORING → ACTIVE_HEALTHY`. Owned by the worker (Constitution V); the api only enqueues.
