# Implementation Plan: Selfbase — Self-Hosted Supabase Platform

**Branch**: `001-selfbase-supabase-platform` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-selfbase-supabase-platform/spec.md`

**Project-root context**: `plan.md` (root) — the engineering blueprint produced during the interview phase. This file is the speckit-formatted condensation that points to it.

## Summary

Build **Selfbase**, a self-hosted control plane that lets an operator provision and manage multiple full-stack Supabase instances on a single Linux host through a web dashboard, with per-instance HTTPS via Caddy on-demand TLS (HTTP-01), encrypted secrets at rest, daily backups, and pause/resume lifecycle. Technical approach mirrors `/Users/lord/Code/open-frontend`: TypeScript monorepo, Fastify API + BullMQ worker + React/Vite dashboard, plain Postgres for control-plane state, vendored upstream `supabase/docker/*` templated per instance with a one-time-built Studio image (`NEXT_PUBLIC_BASE_PATH=/studio`).

## Technical Context

**Language/Version**: TypeScript 5.x in strict mode on Node.js ≥ 20 (LTS).

**Primary Dependencies**:
- API: Fastify 4, @fastify/session (Redis-backed), zod, undici, drizzle-orm 0.33, pg
- Worker: BullMQ 5, dockerode, ioredis, archiver (backup streaming)
- Web: React 18, Vite 5, React Router 6, @tanstack/react-query 5, TailwindCSS 3 with config + tokens lifted from upstream `supabase/supabase` `apps/studio`
- Crypto: argon2 (Argon2id), jsonwebtoken (HS256), node:crypto (AES-256-GCM)
- Backup-store: @aws-sdk/client-s3 (S3 impl), node fs streams (local impl)
- Reverse proxy: Caddy 2 (admin API on `:2019`, on-demand TLS via `/internal/tls/ask`)

**Storage**:
- Control plane DB: PostgreSQL 16 (Drizzle migrations, idempotent)
- Session + queue: Redis 7
- Per-instance secrets: AES-256-GCM blob in control DB, KEK from `MASTER_KEY` env (32 random bytes)
- Backups: pluggable `BackupStore` — `LocalDiskStore` (default, `/var/selfbase/backups/<ref>/`) + `S3Store`
- Per-instance data: bind-mounted on host at `/var/selfbase/instances/<ref>/` (one directory per provisioned Supabase stack)

**Testing**:
- Unit: Vitest in each package (crypto round-trips, port allocator, BackupStore impls, RBAC matrix)
- Integration: a per-PR suite that spins selfbase + a single managed instance under Docker and verifies real REST + Studio + cert issuance against a test apex (`localtest.me` or self-signed for local)
- Contract: tests that hit each REST endpoint with both admin and member tokens and assert authorization matrix
- E2E (dashboard): Playwright, golden path through first-time setup → create instance → view credentials → pause → resume → backup → delete

**Target Platform**: Single Linux host. Reference target: Ubuntu 24.04 LTS, Docker Engine ≥ 24, Docker Compose v2 plugin. The currently provisioned VM `148.113.1.164` (Ubuntu 24.04, Docker 29.1.2) is the dev/demo target.

**Project Type**: Web application (backend API + worker + frontend), monorepo. Maps to Option 2 in the template with modifications (added `worker/`, `caddy/`, shared `packages/`).

**Performance Goals**:
- Provision to "running" status ≤ 90 s on warm-image host (SC-002).
- First-request HTTPS cert issuance ≤ 60 s (SC-004).
- Pause ≤ 30 s, resume ≤ 60 s (SC-005).
- Dashboard perceived navigation < 1 s with 15 running instances on a 32 GB host (SC-010).
- 100 MB DB backup ≤ 60 s on local-disk store (SC-006).

**Constraints**:
- Single host only — no `host_id` in schema, no scheduler.
- No wildcard TLS — every subdomain uses HTTP-01 via Caddy on-demand TLS gated by `/internal/tls/ask`.
- Secrets never plaintext at rest. System MUST refuse to start without a valid `MASTER_KEY`.
- Generated `POSTGRES_PASSWORD` and similar values MUST be alphanumeric only (no `$` — Docker Compose substitution hazard, observed in Multibase's `huntvox/.env`).
- Per-instance `.env` MUST include every variable the upstream `supabase/docker/docker-compose.yml` references, with empty-string fallback for unused ones (catches the Multibase missing-vars failure mode).
- All instance lifecycle work runs through BullMQ jobs — the API never blocks on `docker compose` calls.

**Scale/Scope**:
- ~15 concurrent full-stack instances per 32 GB host (≈1.5–2 GB RAM each).
- ~3–4 k LOC of selfbase code (excluding vendored Supabase template).
- v1 ships dashboard + REST API only (no CLI, no MCP).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the unmodified speckit template (placeholders only). No project-specific principles have been ratified. For this feature we apply default industry practices as the implicit gates:

| Gate | Status | Note |
|---|---|---|
| Security: secrets at rest encrypted | PASS | AES-256-GCM with KEK from env; startup fails on missing key (FR-011, FR-012, SC-011) |
| Security: passwords hashed | PASS | Argon2id (FR-006) |
| Security: real JWT signing | PASS | HS256 via `jsonwebtoken`; explicit anti-pattern called out in root `plan.md` §"Bugs Explicitly Not To Repeat" item 1 |
| Operability: structured logs + audit log | PASS | Audit log table + structured pino logs (FR-032) |
| Reliability: lifecycle through queue (no blocking API) | PASS | All slow ops via BullMQ |
| Reproducibility: idempotent migrations | PASS | Per the project's global rule + Drizzle's `migrate()` semantics |
| Testability: contract + integration + e2e | PASS | Vitest + Playwright + integration suite (this Technical Context) |
| Simplicity: no premature multi-host | PASS | Single-host explicitly accepted (Assumption + FR scoping) |

No violations to track in Complexity Tracking.

**Post-Phase-1 re-check**: After Phase 1 artifacts (`research.md`, `data-model.md`, `contracts/`, `quickstart.md`) are produced, re-evaluate. See bottom of this file.

## Project Structure

### Documentation (this feature)

```text
specs/001-selfbase-supabase-platform/
├── plan.md              # this file
├── spec.md              # user-facing specification (already written)
├── research.md          # Phase 0 output (generated below)
├── data-model.md        # Phase 1 output (generated below)
├── quickstart.md        # Phase 1 output (generated below)
├── contracts/
│   ├── rest-api.md      # public REST API contract
│   ├── internal.md      # internal endpoints (Caddy tls-ask, worker callbacks)
│   └── compose-env.md   # the complete per-instance .env contract
├── checklists/
│   └── requirements.md  # already written (all passing)
└── tasks.md             # Phase 2 output (created later by /speckit-tasks)
```

### Source Code (repository root)

```text
selfbase/
├── apps/
│   ├── api/                            # Fastify control-plane
│   │   ├── src/
│   │   │   ├── routes/                 # /setup, /auth, /tokens, /instances, /backups, /members, /caddy/tls-ask
│   │   │   ├── plugins/                # auth, rbac, error, cors, helmet, pino-logger
│   │   │   ├── services/
│   │   │   │   ├── caddy-config.ts     # builds full Caddy JSON config
│   │   │   │   ├── caddy-reload.ts     # POST to admin :2019/load
│   │   │   │   └── tls-ask.ts          # /internal/tls/ask handler
│   │   │   └── server.ts
│   │   └── tests/
│   ├── web/                            # React + Vite dashboard
│   │   ├── src/
│   │   │   ├── lib/api.ts              # axios client; VITE_API_URL='' → relative /api
│   │   │   ├── pages/                  # Setup, Login, Instances, InstanceDetail, Backups, Members, Tokens
│   │   │   ├── components/
│   │   │   └── theme/                  # Tailwind config + tokens lifted from supabase/studio (vendored, pinned commit)
│   │   ├── vite.config.ts              # allowedHosts: true; proxy /api + /socket.io to api in dev
│   │   └── tests/                      # Playwright e2e
│   ├── worker/                         # BullMQ jobs
│   │   ├── src/
│   │   │   ├── jobs/
│   │   │   │   ├── provision.ts
│   │   │   │   ├── lifecycle.ts        # pause/resume/restart/delete/upgrade
│   │   │   │   ├── backup.ts
│   │   │   │   ├── backup-scheduler.ts # hourly repeatable; enqueues backups for instances overdue
│   │   │   │   └── caddy-reload.ts     # debounced reloader
│   │   │   └── main.ts
│   │   └── tests/
│   └── caddy/                          # mounted into Caddy container
│       ├── Caddyfile                   # static skeleton + on_demand_tls block pointing at api
│       └── Dockerfile                  # optional; we mainly use upstream caddy:2 image
├── packages/
│   ├── db/
│   │   ├── src/schema/                 # identity.ts, instances.ts, backups.ts, audit.ts
│   │   ├── migrations/                 # drizzle-kit output, checked in
│   │   └── drizzle.config.ts
│   ├── shared/                         # zod schemas, REST types, RBAC action set
│   ├── crypto/                         # aes-gcm.ts, argon2.ts, jwt.ts (HS256 only, hardened)
│   ├── docker-control/                 # compose-template.ts (consumes a pinned .env.example), dockerode-wrappers.ts
│   └── backup-store/                   # interface + LocalDiskStore + S3Store + tests
├── infra/
│   ├── docker-compose.yml              # selfbase stack: postgres, redis, caddy, api, worker, web
│   ├── supabase-template/              # vendored copy of upstream supabase/docker/* (pinned commit)
│   │   ├── docker-compose.yml
│   │   ├── .env.example                # source of truth for required vars
│   │   ├── kong.yml
│   │   ├── vector.yml
│   │   └── volumes/                    # init SQL files
│   └── studio/
│       └── Dockerfile                  # builds Studio with NEXT_PUBLIC_BASE_PATH=/studio (one image, used by every instance)
├── install.sh                          # one-shot installer (mirrors patterns from /Users/lord/Code/superbase/install.sh)
├── package.json                        # pnpm workspaces root
├── pnpm-workspace.yaml
├── plan.md                             # engineering blueprint (project-root, already exists)
└── specs/001-selfbase-supabase-platform/  # this directory
```

**Structure Decision**: Web application monorepo (extended Option 2). Backend = `apps/api` + `apps/worker`; frontend = `apps/web`; the `caddy/` app and the `infra/supabase-template/` + `infra/studio/` vendored bits are first-class members of the structure rather than ad-hoc scripts. Shared concerns (DB, crypto, docker, backup store, shared types) live in `packages/` so they can be unit-tested in isolation and consumed by both API and worker.

## Complexity Tracking

No constitution violations. Complexity Tracking table omitted.

## Post-Phase-1 Constitution Re-check

After generating `research.md`, `data-model.md`, `contracts/*`, and `quickstart.md`:

| Gate | Status | Note |
|---|---|---|
| All gates from initial check | PASS | Design artifacts reinforce, do not violate, the initial gate list |
| New gate: RBAC matrix has tests for every (role × action) cell | PASS | Listed as a Vitest suite under `apps/api/tests/contract/` in research.md §Testing strategy |
| New gate: every required upstream `.env` variable is enumerated | PASS | `contracts/compose-env.md` defines the complete set; `infra/supabase-template/.env.example` is the source of truth |
| New gate: Caddy reload is idempotent + atomic | PASS | `caddy-reload.ts` posts the FULL config to `/load` (atomic swap), not partial updates; debounced (200 ms) to coalesce churn |

All gates still pass.
