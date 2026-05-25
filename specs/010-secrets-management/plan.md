# Implementation Plan: Secrets management — single-track via supabase_vault

**Branch**: `010-secrets-management` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)

## Summary

Cut all user-managed secrets over to per-project `supabase_vault` as the single source of truth. Three coordinated changes: (1) enable `pgsodium` + `supabase_vault` per-project (provision + boot-time backfill of existing instances), (2) rewire the existing `/v1/projects/<ref>/secrets` API to read/write `vault.secrets` instead of `project_secrets` + `.env`, build a dashboard CRUD page at `/dashboard/project/<ref>/secrets`, and patch the per-project edge runtime `main/index.ts` to fetch from vault with a 5s passive TTL cache and inject as `envVars` on worker spawn — eliminating the functions-container restart on save, (3) add a Caddy 302 from Studio's broken `/project/default/functions/secrets` URL to the new dashboard page. No automated migration of pre-existing `project_secrets` rows — operators re-enter secrets post-upgrade (documented breaking change).

## Technical Context

**Language/Version**: TypeScript (Node 20 for api/worker, Deno 1.46+ in per-project edge runtime via `supabase/edge-runtime:1.58.x`)

**Primary Dependencies**: Fastify (api), BullMQ (worker), Drizzle ORM (control-plane DB), `pg` client (per-project DB access from api/worker), React + Vite + shadcn/ui + Tailwind (web), Caddy (reverse proxy), `supabase/postgres:15.8.1.085` (bundles `pgsodium` + `supabase_vault`), `supabase/edge-runtime` (Deno)

**Storage**:
- Per-project Postgres `vault.secrets` (pgsodium-encrypted) — single source of truth for user secrets
- Control-plane `project_secrets` table — **deprecated, not read or written by this feature**; left in place pending drop migration
- Reserved env (`SUPABASE_URL`, `JWT_SECRET`, etc.) — per-instance compose env, unchanged

**Testing**: Vitest for api unit/contract tests (`apps/api/tests/`), Vitest for worker units, Playwright for web (existing pattern), shell scripts in `tests/cli-e2e/` for live-VM integration

**Target Platform**: Linux server (single VM Docker compose stack). VM: `ubuntu@148.113.1.164`, apex `supaviser.dev`.

**Project Type**: Web application monorepo — `apps/api`, `apps/worker`, `apps/web`, `apps/caddy`, `infra/`, `packages/*`

**Performance Goals**:
- Dashboard Save → visible in `Deno.env.get()` within ≤10s (SC-002), driven by 5s default TTL (FR-015)
- ≤1 `SELECT FROM vault.decrypted_secrets` per project per TTL window under load (SC-010)
- Saving 10 secrets end-to-end in <5s (SC-003)

**Constraints**:
- Wire contract (`POST/GET/DELETE /v1/projects/<ref>/secrets`) MUST be preserved (SC-008) — CLI/curl callers unaffected
- No container restart on save (SC-002, breaks current behavior)
- Idempotent vault enablement (FR-002) — safe to re-run on backup-restored instances
- Reserved-name guard enforced at write time AND at injection time (defense in depth, FR-014)

**Scale/Scope**:
- ~10s of projects per VM (current deployment), single-operator platform
- ~20–50 user-managed secrets per project typical
- Documented breaking change at cutover: existing `project_secrets` rows are abandoned (Assumptions)

## Constitution Check

*GATE: N/A — project constitution at `.specify/memory/constitution.md` is the unfilled template (no ratified principles).*

No constraints to gate against. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/010-secrets-management/
├── plan.md              # This file
├── spec.md              # Feature spec (with Clarifications session 2026-05-25)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API + runtime contracts)
│   ├── api-secrets-v1.md
│   ├── api-secrets-dashboard.md
│   ├── runtime-injection.md
│   └── caddy-redirect.md
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # (Phase 2 — /speckit-tasks)
```

### Source Code (repository root)

```text
apps/
  api/
    src/
      routes/
        secrets.ts                    # MODIFIED — /v1/projects/<ref>/secrets, rewired to vault
        secrets-dashboard.ts          # NEW — /api/v1/projects/<ref>/secrets (session-auth twin)
        vault-enable.ts               # NEW — POST /api/v1/projects/<ref>/vault/enable (dashboard button)
      services/
        vault-client.ts               # NEW — per-project pg client + vault.* helpers
        secret-store.ts               # MODIFIED — facade rewritten over vault-client; reserved-name list moved to @selfbase/shared
        vault-bootstrap.ts            # NEW — CREATE EXTENSION sequence + pgsodium.create_root_key idempotency
      server.ts                       # MODIFIED — register new routes
    tests/
      unit/
        vault-bootstrap.test.ts       # NEW
        secret-store.test.ts          # MODIFIED — vault-backed
      contract/
        secrets-v1.contract.test.ts   # NEW — wire contract preservation (SC-008)
  worker/
    src/
      jobs/
        vault-enable-job.ts           # NEW — BullMQ job: connect + CREATE EXTENSION + verify
      main.ts                         # MODIFIED — register vault-enable processor
  web/
    src/
      pages/
        ProjectSecrets.tsx            # NEW — dashboard CRUD page
      lib/
        api.ts                        # MODIFIED — secretsApi.list/upsert/delete + vaultApi.enable
  caddy/
    Caddyfile                         # MODIFIED — add redirect rule (US4)

infra/
  supabase-template/
    volumes/functions/main/
      index.ts                        # NEW (overrides upstream) — vault-fetching bootstrap with 5s TTL cache

packages/
  shared/
    src/
      reserved-secrets.ts             # NEW — moved from apps/api/src/services/secret-store.ts; with descriptions
      rbac.ts                         # MODIFIED — add 'instance.secrets.read' + 'instance.secrets.write' + 'instance.vault.enable' actions
  db/
    migrations/
      0010_drop_project_secrets_table.sql  # NEW (idempotent, optional/follow-up — not blocking)
```

**Structure Decision**: Selfbase monorepo (apps + packages + infra). Existing layout extended; no new top-level dirs. New `vault-client` service centralizes per-project Postgres access for the api so we don't sprinkle `pg.Client` instantiations across routes. Reserved-secret list relocated to `packages/shared` so the runtime injection guard (in the templated `main/index.ts`) and the api/web all reference one source — runtime gets it via a build-time copy into the functions image (research.md Decision 4).

## Complexity Tracking

*No constitution gates to violate. No exceptions to justify.*
