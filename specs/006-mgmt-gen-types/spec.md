# Feature Specification: Supabase CLI Management API — `gen types typescript`

**Feature Branch**: `006-cli-mgmt-tier1` (kept for git history; see `.specify/feature.json` for the active directory)

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "pick up issue #4, scope to just gen types" — narrows the earlier Tier 1 group (issue #4) to its single highest-demand endpoint. The other three endpoint groups originally in this spec have been split out as separate low-priority issues:
- Custom domains → issue #10
- postgrest + auth runtime config → issue #11
- ssl-enforcement → issue #12

## Background

selfbase already implements the P0 subset of Supabase's Management API (shipped in feature 003): the endpoints the upstream Supabase CLI calls for `supabase login`, `supabase link`, `supabase functions deploy/list/download/delete`, and `supabase secrets set/list/unset`. Every other `/v1/*` route currently returns a structured `501 not_implemented` envelope.

This feature replaces that 501 for one specific endpoint: `GET /v1/projects/<ref>/types/typescript`, which powers `supabase gen types typescript --project-id <ref>`. This is by far the highest-demand Tier 1 endpoint — every TypeScript-based Supabase project calls it in its build step to generate fully typed table/column access without hand-writing interfaces.

Out of scope for this feature: all other Tier 1, 2, and 3 endpoints (tracked separately).

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

### Edge Cases

- **No user tables**: requesting types for a fresh project with only system schemas must still emit a valid `Database` type (empty `public.Tables`) rather than a syntax-broken file.
- **Schema not present**: requesting `--schema fakeschema` returns 400 with `{ schema: "not found" }`, not a 500.
- **Paused project**: returns 409 with `project_not_running`. CLI should retry once the project is resumed.
- **Tables with PostgreSQL types that have no clean TS equivalent** (e.g., `tsvector`, custom composites, range types, geometric types): map to a sensible fallback (`unknown` or `string`) without crashing the whole generation.
- **Generated columns / identity columns**: must be marked as not-required in the Insert variant and not-allowed in the Update variant, matching Cloud behavior.
- **Views and materialized views**: included in `Database.<schema>.Views`, with only the Row variant (no Insert/Update).
- **Database functions (RPC)**: included in `Database.<schema>.Functions` with typed Args/Returns.
- **Very large schemas (1000+ tables)**: must complete in under 30 seconds without exhausting the API container's memory.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose `GET /v1/projects/<ref>/types/typescript` returning a JSON envelope `{ types: <string> }` whose `types` value is a TypeScript source representation of the project's schema, byte-compatible with what Supabase Cloud's same endpoint returns for the same schema shape.
- **FR-002**: The endpoint MUST accept an optional repeatable `schemas` query parameter (`?schemas=public&schemas=auth`); when omitted, default to `public` only — matching upstream CLI default.
- **FR-003**: The endpoint MUST require a valid Personal Access Token (same auth as existing P0 endpoints), and MUST reject requests for refs the PAT's owner does not have access to with a 403.
- **FR-004**: System MUST return 404 for unknown refs and 409 for refs whose project is not `running`, with the standard error envelope.
- **FR-005**: For every table, view, materialized view, enum, and function in the selected schemas, the generated TypeScript MUST be byte-compatible with what Supabase Cloud's `pg-meta`-driven generator emits — same field ordering, same type mappings, same Row/Insert/Update split.
- **FR-006**: The emitted file MUST validate against `@supabase/supabase-js`'s `Database` type constraints — i.e., it can be passed as the generic to `createClient<Database>(...)` and SDK operations (`.from('table').select(...)`) return the expected types under `tsc --noEmit`.
- **FR-007**: This endpoint MUST replace its previous `501 not_implemented` response. All other Tier 1/2/3 endpoints continue to return `501 not_implemented`.
- **FR-008**: Authentication MUST reuse the existing PAT mechanism shipped in feature 003. No new auth surface is introduced.
- **FR-009**: Errors MUST use the existing structured error envelope (`{ error: { code, message, details? } }`) and HTTP status conventions already in use across `/v1/*`.
- **FR-010**: Reads MUST NOT emit an audit log entry (audit-level read events are out of scope). Writes are not applicable — this is a read-only endpoint.

### Key Entities

This feature is read-only against existing per-instance Postgres state. No new entities introduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `supabase gen types typescript --project-id <ref>` against a selfbase instance completes in under 10 seconds for a project with up to 100 tables (and under 30 seconds for up to 1000 tables), with the emitted file passing `tsc --noEmit` against `@supabase/supabase-js`.
- **SC-002**: For 100% of selected schemas/tables in a test fixture project (~20 tables across 2 schemas, mix of enums + views + functions + identity columns + generated columns), the emitted types match the actual DB shape verified by automated comparison against `information_schema`.
- **SC-003**: For the same fixture project, the byte-by-byte diff between selfbase's output and what Supabase Cloud's same endpoint emits is zero (modulo whitespace) when comparison is possible; if Cloud's exact output is not accessible, the emitted file MUST round-trip through `tsc --noEmit` with no errors AND every `Tables.<name>.Row` field must match the corresponding `information_schema.columns` entry.
- **SC-004**: Existing P0 CLI commands (`login`, `link`, `functions *`, `secrets *`) continue to pass their existing integration tests with zero regressions.
- **SC-005**: The endpoint handles a malformed or non-existent schema parameter with a 400 response in under 100ms (i.e., validation rejects before doing any DB work).

## Assumptions

- The upstream Supabase CLI's request/response shapes for this endpoint are the source of truth — selfbase matches them byte-for-byte so the CLI does not need a selfbase-specific build. We target the current stable Supabase CLI release at feature start.
- The per-instance Postgres exposes the schemas + tables we need to introspect. The `pg-meta` container that ships with every Supabase stack already provides a typed introspection surface — implementation may reuse it (call `pg-meta` per-instance from the api) rather than re-implementing introspection from `information_schema` directly.
- Existing PAT auth, RBAC ownership checks, and the rate-limit envelope from feature 003 are reused unchanged. This feature does not introduce a new auth or rate-limit surface.
- The dashboard UI for a "Copy types" button is out of scope. CLI compatibility is the primary deliverable.
- TypeScript type-emission for PostgreSQL types follows the same mapping as upstream Supabase: numeric → `number`, text/varchar/uuid → `string`, bool → `boolean`, jsonb → `Json`, arrays → `T[]`, enums → string-literal unions, custom/composite types → `unknown`.
