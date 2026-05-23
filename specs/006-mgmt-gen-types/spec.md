# Feature Specification: Supabase CLI — `gen types typescript` + `migration *`

**Feature Branch**: `006-cli-mgmt-tier1` (kept for git history; see `.specify/feature.json` for the active directory)

**Created**: 2026-05-23

**Status**: Draft

**Input**: User descriptions:
1. "pick up issue #4, scope to just gen types" — narrows the earlier Tier 1 group (issue #4) to its single highest-demand endpoint
2. "lets add supabase migrations * to the spec" — extends scope to also cover the full `supabase migration` CLI subcommand family

Sibling endpoint groups split out as low-priority issues:
- Custom domains → issue #10
- postgrest + auth runtime config → issue #11
- ssl-enforcement → issue #12

## Background

selfbase already implements the P0 subset of Supabase's Management API (shipped in feature 003): the endpoints the upstream Supabase CLI calls for `supabase login`, `supabase link`, `supabase functions deploy/list/download/delete`, and `supabase secrets set/list/unset`. Feature 005 unblocked `supabase db push/pull/diff` by exposing per-instance Postgres at `db.<ref>.<apex>:5432` and a multi-tenant pooler at `pooler.<apex>:6543`.

This feature replaces the `501 not_implemented` response for two more CLI surfaces:

**US1 — `supabase gen types typescript`** is by far the highest-demand single endpoint — every TypeScript-based Supabase project calls it in its build step to generate fully typed table/column access without hand-writing interfaces.

**US2 — `supabase migration *`** is the standard workflow for evolving the per-project Postgres schema over time. Selfbase already supports the push side (via feature 005's pooler/direct DB endpoints), but the CLI also exposes list / repair / fetch operations that need a small Management-API surface to read and patch the `supabase_migrations.schema_migrations` history table when the CLI is invoked in `--linked` mode without an explicit `--db-url` flag.

Out of scope for this feature: all other Tier 1, 2, and 3 endpoints (tracked separately), and arbitrary-SQL `POST /v1/projects/<ref>/database/query` (deferred — security-sensitive, requires its own design).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Generate TypeScript types for a project (Priority: P1)

A developer is wiring up a TypeScript app against their self-hosted Supabase project. They want fully typed table/column access without hand-writing interfaces. They run `supabase gen types typescript --project-id <ref> --schema public > database.types.ts` from their project root, pointing the CLI at their selfbase instance, and get a TypeScript source file containing exact types for every table, view, enum, and function in the selected schema(s) — identical in shape to what Supabase Cloud emits, so the rest of the Supabase JS SDK type ergonomics work unchanged.

**Why this priority**: Highest user demand. Without it, every TypeScript-based Supabase project on selfbase loses static type safety on table access — a major regression from the Cloud experience.

**Independent Test**: Run `supabase gen types typescript --project-id <existing-ref>` against the test VM. Result must (a) exit 0, (b) emit valid TypeScript that compiles when fed to `tsc --noEmit`, (c) include a `Database` type whose `public` schema lists all user tables of that project.

**Acceptance Scenarios**:

1. **Given** a project exists with at least one user-defined table in `public`, **When** the CLI generates types, **Then** the emitted file declares that table under `Database.public.Tables.<tableName>` with the correct columns, types, nullability, and Row/Insert/Update variants.
2. **Given** the developer passes `--schema public --schema auth`, **When** types are generated, **Then** both schemas appear in the emitted file under `Database.<schema>`.
3. **Given** an invalid project ref, **When** the CLI requests types, **Then** the response is a 404 with the standard error envelope and the CLI exits non-zero with a helpful message.
4. **Given** the requester is unauthenticated, **When** the endpoint is called without a valid PAT, **Then** the response is 401.
5. **Given** the requester is authenticated but lacks access to that project, **When** the endpoint is called, **Then** the response is 403.

---

### User Story 2 — Manage database migrations end-to-end from CLI (Priority: P1)

A developer working against a self-hosted selfbase project wants the same migration workflow they'd have against Supabase Cloud:

1. Create a new migration file locally: `supabase migration new add_users_table`
2. Edit the generated SQL
3. Push it to the remote project: `supabase migration up` (or `supabase db push`)
4. List the project's migration history: `supabase migration list` — shows local + remote with applied/pending status side by side
5. If the history table gets out of sync (e.g., manual SQL ran in production), repair it: `supabase migration repair 20260520120000 --status applied`
6. Pull the remote history back to local for reconciliation: `supabase migration fetch`
7. Squash old local migrations into one before a release: `supabase migration squash`

All of these must work against a selfbase project using only the project ref (`supabase link --project-ref <ref>`), with no `--db-url` flag required.

**Why this priority**: Database migration is the canonical day-2 workflow for every Supabase project. Half the operations (`new`, `squash`) are local-only, but the other half need the Management API to read and patch the history table. Without these endpoints, the CLI either fails outright or forces the user to always pass `--db-url` explicitly — a real-world friction every team will hit.

**Independent Test**: From a developer machine linked to a fresh selfbase project: create a migration, push it, list to confirm it shows as `applied` both locally and remotely, manually delete its row from `supabase_migrations.schema_migrations`, run `migration repair … --status applied` to restore, list again to confirm restoration, then run `migration fetch` to verify the local mirror reconstructs cleanly.

**Acceptance Scenarios**:

1. **Given** a freshly linked project with no migrations applied, **When** the developer runs `supabase migration list`, **Then** the response shows zero applied migrations and zero local migrations.
2. **Given** a local migration file at `supabase/migrations/20260520120000_add_users_table.sql`, **When** the developer runs `supabase migration up`, **Then** the migration is applied to the remote Postgres and a row appears in `supabase_migrations.schema_migrations`.
3. **Given** the migration above is applied, **When** the developer runs `supabase migration list`, **Then** the response lists `20260520120000` with status `Applied` in both Local and Remote columns.
4. **Given** the row was manually removed from `supabase_migrations.schema_migrations` (simulating drift), **When** the developer runs `supabase migration repair 20260520120000 --status applied`, **Then** the row reappears with that version and the next `list` shows `Applied` in Remote again.
5. **Given** an applied migration the developer wants to mark as reverted, **When** they run `supabase migration repair 20260520120000 --status reverted`, **Then** the row is removed from `schema_migrations`.
6. **Given** a project with N applied migrations recorded only remotely (i.e., the local `supabase/migrations/` directory is empty), **When** the developer runs `supabase migration fetch`, **Then** the local directory is populated with N migration files corresponding to each remote version.
7. **Given** an invalid project ref or a project not in `running` state, **When** any migration subcommand is invoked in linked mode, **Then** the CLI surfaces a clear error (404 for unknown ref, 409 for not-running) using the standard error envelope.
8. **Given** an authenticated user without access to the project, **When** any migration subcommand is invoked, **Then** the response is 403.

---

### Edge Cases

#### Gen types

- **No user tables**: requesting types for a fresh project with only system schemas must still emit a valid `Database` type (empty `public.Tables`) rather than a syntax-broken file.
- **Schema not present**: requesting `--schema fakeschema` returns 400 with `{ schema: "not found" }`, not a 500.
- **Paused project**: returns 409 with `project_not_running`. CLI should retry once the project is resumed.
- **Tables with PostgreSQL types that have no clean TS equivalent** (e.g., `tsvector`, custom composites, range types, geometric types): map to a sensible fallback (`unknown` or `string`) without crashing the whole generation.
- **Generated columns / identity columns**: must be marked as not-required in the Insert variant and not-allowed in the Update variant, matching Cloud behavior.
- **Views and materialized views**: included in `Database.<schema>.Views`, with only the Row variant (no Insert/Update).
- **Database functions (RPC)**: included in `Database.<schema>.Functions` with typed Args/Returns.
- **Very large schemas (1000+ tables)**: must complete in under 30 seconds without exhausting the API container's memory.

#### Migrations

- **`migration list` against a project that has never had any migrations**: must return an empty array (not 404, not 500) and the CLI must display "No migrations found" rather than crashing.
- **`migration repair` for a version that doesn't match the timestamp format** (`YYYYMMDDHHmmss`): the API must validate the version format and return 400 with `invalid_version_format`.
- **`migration repair --status applied` for a version that's already present**: idempotent — returns 200, no duplicate row inserted.
- **`migration repair --status reverted` for a version that doesn't exist**: idempotent — returns 200, no error.
- **`migration up` when the migration SQL fails partway through**: the failed migration must NOT be recorded as applied; subsequent `list` must show it as pending; the CLI surfaces the SQL error verbatim from Postgres.
- **`migration fetch` against a project with 500+ applied migrations**: must complete in under 30 seconds and stream rather than buffer the entire response.
- **`migration up` racing two CLI sessions against the same project**: the second session must see the first session's applied migrations on its next list, and not double-apply. This relies on the standard advisory-lock pattern the CLI already uses against `supabase_migrations.schema_migrations` — no new locking surface needed.
- **`supabase_migrations` schema missing**: if a project's Postgres is missing the migrations schema entirely (e.g., wiped), the list endpoint must create it lazily on first call and return an empty array rather than 500.

## Requirements *(mandatory)*

### Functional Requirements

#### Gen types

- **FR-001**: System MUST expose `GET /v1/projects/<ref>/types/typescript` returning a JSON envelope `{ types: <string> }` whose `types` value is a TypeScript source representation of the project's schema, byte-compatible with what Supabase Cloud's same endpoint returns for the same schema shape.
- **FR-002**: The endpoint MUST accept an optional repeatable `schemas` query parameter (`?schemas=public&schemas=auth`); when omitted, default to `public` only — matching upstream CLI default.
- **FR-003**: For every table, view, materialized view, enum, and function in the selected schemas, the generated TypeScript MUST be byte-compatible with what Supabase Cloud's `pg-meta`-driven generator emits — same field ordering, same type mappings, same Row/Insert/Update split.
- **FR-004**: The emitted file MUST validate against `@supabase/supabase-js`'s `Database` type constraints — i.e., it can be passed as the generic to `createClient<Database>(...)` and SDK operations (`.from('table').select(...)`) return the expected types under `tsc --noEmit`.
- **FR-005**: This endpoint MUST replace its previous `501 not_implemented` response.

#### Migrations

- **FR-006**: System MUST expose `GET /v1/projects/<ref>/database/migrations` returning an array of `{ version: string, name: string | null, statements: string[] | null }` for every row currently in `supabase_migrations.schema_migrations` on the per-project Postgres, ordered by `version` ascending. Matches upstream Cloud shape.
- **FR-007**: System MUST expose `POST /v1/projects/<ref>/database/migrations/upsert` accepting `{ version: string, name?: string, statements?: string[] }` and inserting (or updating) the corresponding row in `supabase_migrations.schema_migrations`. Idempotent: re-upserting the same version returns 200 with no duplicate.
- **FR-008**: System MUST expose `DELETE /v1/projects/<ref>/database/migrations/<version>` removing the row matching that version. Idempotent: deleting a non-existent version returns 200.
- **FR-009**: All three migrations endpoints MUST validate `version` against the format `^\d{14}$` (YYYYMMDDHHmmss) and reject malformed versions with a 400 + `invalid_version_format`.
- **FR-010**: All three migrations endpoints MUST create the `supabase_migrations` schema and `schema_migrations` table on first call if they don't exist (lazy bootstrap), to handle projects whose Postgres was provisioned before the table existed.
- **FR-011**: These endpoints MUST replace their previous `501 not_implemented` responses.
- **FR-012**: Migration write operations (upsert, delete) MUST emit an audit log entry capturing actor (user_id), project ref, endpoint, version, and old + new value.

#### Cross-cutting (all endpoints in this feature)

- **FR-013**: Every endpoint MUST require a valid Personal Access Token (same auth as existing P0 endpoints), and MUST reject requests for refs the PAT's owner does not have access to with a 403.
- **FR-014**: Every endpoint MUST return 404 for unknown refs and 409 for refs whose project is not `running`, with the standard error envelope.
- **FR-015**: Authentication MUST reuse the existing PAT mechanism shipped in feature 003. No new auth surface is introduced.
- **FR-016**: Errors MUST use the existing structured error envelope (`{ error: { code, message, details? } }`) and HTTP status conventions already in use across `/v1/*`.
- **FR-017**: All other Tier 1/2/3 endpoints outside this feature continue to return `501 not_implemented`.

### Key Entities

- **Schema migration row**: a record in the per-project Postgres at `supabase_migrations.schema_migrations` with at minimum `version` (14-digit timestamp string, primary key), `name` (nullable, free-form), and `statements` (nullable text array). This entity already exists in the per-project Postgres — the feature exposes it through the Management API rather than creating new storage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `supabase gen types typescript --project-id <ref>` against a selfbase instance completes in under 10 seconds for a project with up to 100 tables (and under 30 seconds for up to 1000 tables), with the emitted file passing `tsc --noEmit` against `@supabase/supabase-js`.
- **SC-002**: For 100% of selected schemas/tables in a test fixture project, the emitted types match the actual DB shape verified by automated comparison against `information_schema`.
- **SC-003**: Round-trip migration test passes: from a freshly linked project, the sequence `migration new` → edit SQL → `migration up` → `migration list` → manual row delete → `migration repair --status applied` → `migration list` → `migration fetch` completes with each command exiting 0 and the final state matching the initial state.
- **SC-004**: `supabase migration list` against a project with up to 500 applied migrations returns within 5 seconds.
- **SC-005**: `supabase migration fetch` against a project with up to 500 applied migrations completes within 30 seconds.
- **SC-006**: Two concurrent `supabase migration up` invocations against the same project from different CLI sessions do not result in the same migration being applied twice (verified by counting rows in `schema_migrations` after both runs complete).
- **SC-007**: Existing P0 CLI commands (`login`, `link`, `functions *`, `secrets *`) plus the feature-005 commands (`db push/pull/diff`) continue to pass their existing integration tests with zero regressions.
- **SC-008**: All seven `supabase migration` subcommands (`new`, `up`, `list`, `repair`, `fetch`, `squash`, `down`) are usable end-to-end against a selfbase project. (`new`, `squash`, `down` are local-only and were already CLI-functional; this feature ships the four that need API surface plus verifies the local-only ones aren't broken by `--linked` invocation.)

## Assumptions

- The upstream Supabase CLI's request/response shapes for these endpoints are the source of truth — selfbase matches them byte-for-byte so the CLI does not need a selfbase-specific build. We target the current stable Supabase CLI release at feature start.
- The per-instance Postgres exposes the schemas + tables we need to introspect for gen-types. The `pg-meta` container that ships with every Supabase stack already provides a typed introspection surface — implementation may reuse it (call `pg-meta` per-instance from the api) rather than re-implementing introspection from `information_schema` directly.
- For migration endpoints, the api reaches the per-instance Postgres via either the existing `db.<ref>.<apex>:5432` direct endpoint or the internal docker network — the same channel feature 005 already uses for tenant registration. No new network path is introduced.
- The `supabase_migrations` schema is part of the Supabase project template; we lazily bootstrap it on first migration-API call to handle projects provisioned before the template included it (FR-010).
- Existing PAT auth, RBAC ownership checks, and the rate-limit envelope from feature 003 are reused unchanged across all endpoints in this feature.
- `supabase migration up` itself is just a thin wrapper around `supabase db push` for unapplied migrations — feature 005 already made that work. This feature primarily adds the read + repair surface around it.
- Dashboard UI for migration history / "Copy types" / etc. is out of scope. CLI compatibility is the primary deliverable.
- TypeScript type-emission for PostgreSQL types follows the same mapping as upstream Supabase: numeric → `number`, text/varchar/uuid → `string`, bool → `boolean`, jsonb → `Json`, arrays → `T[]`, enums → string-literal unions, custom/composite types → `unknown`.
- Arbitrary-SQL execution via `POST /v1/projects/<ref>/database/query` is explicitly NOT in scope — that endpoint is security-sensitive (it's basically a remote `psql -c`) and warrants its own spec when the demand arises. Migration endpoints are tightly scoped to the `schema_migrations` table only.
