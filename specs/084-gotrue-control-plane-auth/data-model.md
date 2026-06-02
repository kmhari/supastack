# Phase 1 — Data Model

Control `db` (PostgreSQL 16). GoTrue owns the `auth` schema; Drizzle owns `public`. All `public`
changes ship in one **idempotent** migration (`packages/db/migrations/00NN_gotrue_orgs.sql`); the
legacy-table drops are the single approved destructive step (greenfield), guarded with
`IF EXISTS` and ordered after dependents are repointed.

## Entities

### `auth.users` (GoTrue-owned — not a Drizzle table)
The identity source of truth: `id uuid`, `email`, encrypted password, confirmation state, etc.
Managed entirely by GoTrue. supastack references `auth.users(id)` from `public` tables and reads
`auth.users.email` for display. No Drizzle migration touches this schema.

### `installation` (new singleton — replaces the platform half of `org`)
| Column | Type | Notes |
|---|---|---|
| `id` | `integer` PK, default `1` | singleton via `CHECK (id = 1)` (like `setup_state`) |
| `apex_domain` | `text` unique | the VM's apex; read by `caddy-config.ts` |
| `backup_store_kind` | `text` enum(`local`,`s3`) default `local` | |
| `backup_store_config_encrypted` | `bytea` | envelope-encrypted |
| `smtp_config_encrypted` | `bytea` null | operator SMTP creds (envelope); null until configured |
| `created_at` / `updated_at` | `timestamptz` | |

### `organizations` (new — tenant, multi-row)
| Column | Type | Notes |
|---|---|---|
| `id` | `text` PK (20-char ref) | generated via `generateRef()` (same as a project ref); lowercase alphanumeric; **not a UUID**. Serves as both the API `id` and the URL/path `slug`. Immutable. |
| `name` | `text` not null | editable display name (NOT the identifier; not required unique) |
| `created_at` | `timestamptz` default now | |

> No separate `slug` column — the 20-char `id` IS the slug. API responses return `slug = id`; the
> `:slug` path param resolves against `organizations.id`. Matches Cloud, where the org URL token is a
> 20-char string (e.g. `…/org/dbndseeouooxxtupzytx`).

### `organization_members` (new — replaces `org_members`)
| Column | Type | Notes |
|---|---|---|
| `organization_id` | `text` → `organizations(id)` ON DELETE CASCADE | 20-char org ref |
| `user_id` | `uuid` → `auth.users(id)` (soft/deferred FK — see Cutover) | GoTrue user id stays a UUID |
| `role` | `text` enum(`owner`,`administrator`,`developer`,`read_only`) not null | |
| `created_at` | `timestamptz` default now | |
| PK | `(organization_id, user_id)` | |
| Invariant | each org has ≥1 `owner` (enforced in handlers, not a DB constraint) | |

### `organization_invitations` (new — evolves `invites`)
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default random | invitation id (internal) |
| `organization_id` | `text` → `organizations(id)` ON DELETE CASCADE | 20-char org ref |
| `email` | `citext` not null | |
| `token_sha256` | `bytea` unique not null | invite token (sha256 of the emailed token) |
| `role` | `text` enum(4 roles) not null | |
| `invited_by_user_id` | `uuid` → `auth.users(id)` (soft FK) | |
| `expires_at` | `timestamptz` not null | |
| `consumed_at` | `timestamptz` null | |
| `created_at` | `timestamptz` default now | |
| Index | unique partial on `(organization_id, email) WHERE consumed_at IS NULL` | one open invite per email per org |

### `supabase_instances` (existing — repurpose the existing org reference)
| Column | Type | Notes |
|---|---|---|
| `organization_id` | `text` → `organizations(id)` ON DELETE RESTRICT | 20-char org ref; every project belongs to one org; RESTRICT blocks deleting a non-empty org (FR-015). **Note**: `supabase_instances` already has a column referencing the singleton `org.id` (`instances.ts:23`) — repurpose/rename it to point at `organizations.id` rather than adding a second column. |

Index: `(organization_id)` for per-org project listing.

### `api_tokens` (existing — repoint)
`user_id` now references `auth.users(id)` (was `users(id)`). Token format/behavior unchanged.

### Dropped (greenfield cutover)
`public.users`, `public.org`, `public.invites`, `public.org_members` — dropped after `installation`
inherits apex/backups and dependents repoint to `auth.users` / `organizations`.

## Role × capability (RBAC)

`packages/shared/src/rbac.ts`: `ROLES = [owner, administrator, developer, read_only]`. New actions
added to the existing `ACTIONS` set: `org.create`, `org.update`, `org.delete`, `org.members.list`,
`org.members.invite`, `org.members.update-role`, `org.members.remove`. Existing project/backup/etc.
actions stay, but are now evaluated against the caller's role **in the project's org**.

| Action group | owner | administrator | developer | read_only |
|---|:--:|:--:|:--:|:--:|
| org.read / list members / list projects / read project | ✅ | ✅ | ✅ | ✅ |
| project create/update/delete/lifecycle, secrets.write, database.write | ✅ | ✅ | ✅ | ❌ |
| org.members.invite / update-role / remove | ✅ | ✅ | ❌ | ❌ |
| org.update (rename) | ✅ | ✅ | ❌ | ❌ |
| org.delete | ✅ | ❌ | ❌ | ❌ |

> Mapping note: today's `admin` ≈ `owner`/`administrator`; today's `member` ≈ `read_only`+listed
> reveal exceptions. Exact per-action cells are finalized in `rbac.ts` and locked by the contract
> test (every role×action defined).

### Role objects on the wire (captured from Studio)

Studio does NOT treat roles as a string enum — it fetches role **objects** from
`/platform/organizations/:slug/roles` and assigns by numeric `role_id` (members carry
`role_ids: number[]`). So the internal enum maps 1:1 to fixed role objects with stable ids:

| `organization_members.role` (storage) | `role_id` (wire) | `name` (wire) |
|---|:--:|---|
| `owner` | 1 | Owner |
| `administrator` | 2 | Administrator |
| `developer` | 3 | Developer |
| `read_only` | 4 | Read-only |

No `organization_roles` table is needed — the four roles are a fixed, code-defined set. The
members API returns `role_ids: [<id>]` (always single-element); role-assign accepts `role_id`;
`role_scoped_projects` / `project_scoped_roles` are accepted-but-ignored / returned empty (project-
scoped + custom roles are out of scope). The mapping lives next to the matrix in `packages/shared`.

## Cutover & FK strategy

- **Ordering** (single migration, idempotent): (1) create `installation`, copy apex+backup from
  `org`; (2) create `organizations`, `organization_members`, `organization_invitations`; (3) add
  `supabase_instances.organization_id`; (4) repoint `api_tokens.user_id` → `auth.users`; (5)
  `DROP TABLE IF EXISTS org_members, invites, api_tokens_old, users, org` (guarded, dependents first).
- **Cross-schema FK to `auth.users`**: because GoTrue creates `auth.users`, avoid a hard migrate-time
  ordering dependency by declaring `user_id` references to `auth.users(id)` as **deferred** FKs added
  in a guarded `DO` block that no-ops if `auth.users` is absent (re-applied on a later run once GoTrue
  has migrated). On a fresh boot GoTrue migrates `auth` before the app migration runs, so the FK
  normally lands on first pass.
- **Backfill on greenfield**: none — no rows to migrate. `/setup` creates the first
  `auth.users` row, the first `organizations` row, and an `organization_members(owner)` row, plus the
  `installation` singleton.

## Validation rules (from spec)

- Org `id` (= slug) is a 20-char ref from `generateRef()`, assigned at create, retried on the rare
  clash (FR-014, edge: reference collision). `name` is the editable display label, not the identifier.
- Org delete refused while it owns ≥1 project (FR-012) — enforced by `ON DELETE RESTRICT` + a
  pre-check returning a clear 409.
- Last-owner invariant (FR-019) — member remove/role-change refused if it would drop the org's owner
  count to 0.
- Invitation single-use + expiring (edge cases) — `consumed_at` + `expires_at` checked on accept.
