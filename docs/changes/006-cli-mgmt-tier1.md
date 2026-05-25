# Feature 006 — Supabase CLI Tier 1: gen types + migrations

**Closed**: Issue #4 (parent), PR #15
**Status**: ✅ US1 + US2 shipped; US3 → #13, US4 → #14 deferred
**Spec**: [specs/006-mgmt-gen-types/](../../specs/006-mgmt-gen-types/)

## What changed

Before: every `/v1/*` Supabase Management API endpoint outside the P0 subset (login, link, functions, secrets) returned `501 not_implemented`. So `supabase gen types typescript`, `supabase migration list`, etc. failed.

After: two more CLI command groups work fully against selfbase:

- `supabase gen types typescript --project-id <ref>` — generates byte-compatible TS types via per-instance pg-meta
- `supabase migration list/repair/fetch` — round-trip migration history management with lazy `supabase_migrations` schema bootstrap (`migration up` already worked via feature 005's pooler)

## Architecture

| Story              | Endpoint                                                                      | Backend                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **US1** gen types  | `GET /v1/projects/<ref>/types/typescript`                                     | Forwards to per-instance Kong's `/pg/*` proxy (which routes to `pg-meta:8080`) with the project's service_role key. No new port mapping needed — Kong is already host-port-exposed.                             |
| **US2** migrations | `GET/POST/DELETE /v1/projects/<ref>/database/migrations[/upsert\|/<version>]` | Connects to per-instance Postgres via shared `per-instance-pg.ts` helper (ephemeral `pg.Client`); lazy bootstrap of `supabase_migrations.schema_migrations` on every call; idempotent upsert via `ON CONFLICT`. |

## CLI commands now working

```bash
# Gen types (every TS Supabase project uses this in its build)
supabase gen types typescript --project-id <ref> > database.types.ts
supabase gen types typescript --project-id <ref> --schema public --schema auth > all.ts

# Migrations round-trip
supabase migration new add_users
# edit supabase/migrations/<timestamp>_add_users.sql
supabase migration up               # delegates to db push via feature 005's pooler
supabase migration list             # NEW — reads supabase_migrations.schema_migrations
supabase migration repair <ver> --status applied   # NEW
supabase migration repair <ver> --status reverted  # NEW
supabase migration fetch            # NEW — pulls remote history to local files
```

## Two subtle gotchas fixed

1. **`pg-meta` wants `included_schemas=public,auth` comma-separated** — repeated query params (`?included_schemas=public&included_schemas=auth`) trigger `request.query.included_schemas?.split is not a function`. Fixed by always joining client-side.
2. **Lazy bootstrap**: every migrations endpoint starts with `CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (...)` so projects whose Postgres was provisioned before the supabase template added the schema still work.

## Deferred (split into low-priority issues)

| US                           | Issue | Why deferred                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **US3** snippets             | #13   | Selfbase Studio stores snippets in browser localStorage, not in `user_content.content` on the per-project PG. The Cloud `/v1/snippets` endpoint is backed by Supabase's proprietary platform DB. Needs either a control-plane snippet store + Studio integration, or wait for upstream OSS Studio to add server-side support. |
| **US4** backups list/restore | #14   | Heaviest piece of the original spec — new `restore_jobs` entity, async BullMQ restore worker (stop → swap data dir → restart → verify), filesystem-snapshot rollback, GC, RBAC gate, dynamic timeout. ~11 tasks. Warrants its own implementation session.                                                                     |

## Tier 1 siblings (low-priority follow-ups, NOT in this PR)

| Issue | What                                                           |
| ----- | -------------------------------------------------------------- |
| #10   | `supabase domains` — bring-your-own-domain per project         |
| #11   | `supabase postgres-config` + `auth-config` — runtime tunables  |
| #12   | `supabase ssl-enforcement` — toggle hostssl on per-instance PG |

## Key files

- `apps/api/src/services/per-instance-pg.ts` — shared ephemeral `pg.Client` helper (typed errors → 404/409/502)
- `apps/api/src/services/per-instance-meta.ts` — Kong-proxied pg-meta wrapper
- `apps/api/src/services/gen-types-service.ts` — schema validation + pg-meta forwarding
- `apps/api/src/services/migrations-service.ts` — lazy bootstrap + 3 CRUD ops
- `apps/api/src/routes/management/gen-types.ts`
- `apps/api/src/routes/management/migrations.ts`
- `tests/cli-e2e/gen-types.sh`, `tests/cli-e2e/migration-roundtrip.sh` (pending)
