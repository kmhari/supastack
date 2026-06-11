# Implementation Plan: Single-Source Apex — domain set once at install, `/setup` guides DNS

**Branch**: `117-setup-first-bootstrap` | **Date**: 2026-06-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/117-setup-first-bootstrap/spec.md`

## Summary

Make the install-time domain (`SUPASTACK_APEX` env) the **single source of truth**, read directly by every component; **drop** the duplicate `installation.apex_domain` DB column and repoint all ~20 readers to env; remove the `/setup` domain-entry field so the wizard reads the established domain and goes straight to the DNS-records + certificate step (blocking on a local/default domain); make the installer's domain prompt reliable under `curl | bash`; and delete the dead two-source `resolveApex` fallback. No new endpoints, no `/v1` change, no new dependency. One idempotent (explicitly destructive) migration. The boot model is unchanged.

## Technical Context

**Language/Version**: TypeScript (Node 20) for `apps/api` (Fastify) + `apps/worker` (BullMQ) + `apps/web` (React 18 + Vite); Bash for `install.sh`; SQL for the migration.

**Primary Dependencies**: Drizzle ORM (control-plane Postgres), Fastify, React/Vite, Zod (`@supastack/shared` request schemas). No new dependency.

**Storage**: control-plane Postgres. Change = **drop** `installation.apex_domain` (column + its `unique` constraint). The domain is no longer stored; it is read from `process.env.SUPASTACK_APEX`.

**Testing**: Vitest unit (env accessor, local-domain gate, install-prompt resolution logic), a contract test asserting **no code reads `installation.apexDomain`**, web build/lint, and a live-VM smoke on supaviser.dev.

**Target Platform**: single Linux VM control-plane compose stack.

**Project Type**: web control plane (api + worker + web SPA) + infra (compose, installer).

**Performance Goals**: N/A (reads move from a DB round-trip to an env read — strictly cheaper). 

**Constraints**: migration idempotent + re-appliable (Principle I); env value must be present for api **and worker** (worker currently lacks it).

**Scale/Scope**: ~20 reader sites repointed across `apps/api` + `apps/worker`; 2 write paths removed (`setup.ts`, `org.ts`); 1 dead file deleted (`apex-resolver.ts`); 1 schema column dropped + 1 migration; `Setup.tsx` wizard trimmed; `install.sh` prompt hardened; `SUPASTACK_APEX` added to worker compose env.

## Constitution Check

*GATE: re-checked after design below. Result: **PASS**.*

- **I. Idempotent, Additive Schema Evolution** — the migration is `DROP COLUMN IF EXISTS apex_domain` → idempotent (re-runnable no-op). It is **explicitly destructive**, which Principle I permits when intentional; recorded here and in `data-model.md`. No backfill needed (the value lives in env). ✅
- **II. Secrets Stay Encrypted** — the apex domain is **not** a secret; no master-key/secret surface touched. ✅
- **III. Authorize Every Privileged Action** — **no new** privileged endpoint or RBAC action. We *remove* the `apexDomain` write from the already-authorized `PATCH /api/v1/org` (which keeps its `org.write`/name path). No matrix change. ✅
- **IV. Supabase Compatibility Is a Pinned Contract** — **no `/v1/*` change.** `setup` + `org` are the dashboard surface (`/api/v1/*`) with its own envelope. No upstream snapshot affected. ✅
- **V. The Worker Owns Per-Instance State** — no new queue/job; producer/consumer unchanged. We **add `SUPASTACK_APEX` to the worker compose env** so the worker's existing `provision.ts`/`pooler-reconciler.ts` apex reads resolve from env after the column drop. No `QUEUES` change. ✅
- **VI. Spec-Driven, Evidence-Based Delivery** — spec + clarifications done; unit tests for the env accessor + local-domain gate + install-prompt logic; a **contract test** that fails if any code reads `installation.apexDomain`; live-VM smoke. ✅

No Complexity Tracking entries required (the one destructive change is explicitly sanctioned by Principle I).

## Project Structure

### Documentation (this feature)

```text
specs/117-setup-first-bootstrap/
├── plan.md              # this file
├── research.md          # Phase 0 — decisions (env accessor shape, column-drop, prompt, local gate)
├── data-model.md        # Phase 1 — column drop + env source entity
├── quickstart.md        # Phase 1 — verification steps
├── contracts/
│   ├── apex-source.md          # the single env accessor + "no installation.apexDomain reader" invariant
│   ├── setup-and-org-api.md    # /api/v1 body-shape deltas (apexDomain removed) + /apex env-backed response
│   └── installer-prompt.md     # install.sh domain-capture resolution order + /dev/tty + warned localhost
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/
  shared/src/
    apex.ts               # NEW — getApex()/getApexOrThrow()/isRealApex() single accessor (reads process.env.SUPASTACK_APEX)
    schemas.ts            # EDIT — drop apexDomain from Setup body + Org patch schemas
  db/
    src/schema/identity.ts   # EDIT — remove apexDomain column from `installation`
    migrations/0024_drop_installation_apex_domain.sql   # NEW — DROP COLUMN IF EXISTS (idempotent, destructive)

apps/api/src/
  services/apex-resolver.ts   # DELETE — dead two-source resolver (FR-013)
  routes/apex.ts              # EDIT — source apex from env (getApex), expose isReal/local flag
  routes/setup.ts             # EDIT — stop writing apexDomain into installation
  routes/org.ts               # EDIT — remove apexDomain from PATCH body + response + reload trigger
  routes/{wildcard-certs,tls-ask,connect-cli,instances,pooler-status,admin,pg-edge-cert-internal}.ts  # EDIT — read getApex() instead of installation.apexDomain
  services/{caddy-config,pooler-tenants}.ts   # EDIT — read getApex()
  server.ts                   # EDIT — apex-status helper reads env

apps/worker/src/
  jobs/provision.ts           # EDIT — read getApex()
  services/pooler-reconciler.ts  # EDIT — read getApex()

apps/web/src/
  pages/Setup.tsx             # EDIT — remove enter-apex input + orgApi.patch write; block on local/default; land on DNS-records
  lib/api.ts                  # EDIT — drop apexDomain from setupApi.run + orgApi.patch body types

infra/docker-compose.yml      # EDIT — add SUPASTACK_APEX to the worker service env (:?required)
install.sh                    # EDIT — domain capture: $1 arg > env > .env > /dev/tty prompt > warned localhost

tests/
  packages/shared/tests/apex.test.ts            # NEW — getApex/isRealApex
  apps/api/tests/unit/setup-local-gate.test.ts  # NEW — local/default domain blocks DNS+cert
  apps/api/tests/contract/no-apex-domain-reader.test.ts  # NEW — grep-guard: no installation.apexDomain references remain
  tests for install.sh resolution order (bats-style or a node harness of the pure ordering function)
```

**Structure Decision**: existing control-plane monorepo layout (`apps/{api,worker,web}` + `packages/{shared,db}` + root `install.sh` + `infra/`). The new single accessor lives in `@supastack/shared` because **both** `apps/api` and `apps/worker` must read the apex from env.

## Phased approach (for /speckit-tasks)

- **Foundational** — add `packages/shared/src/apex.ts` (`getApex`, `getApexOrThrow`, `isRealApex`); repoint the apex-status path (`apex.ts`, `server.ts`) to env so `GET /api/v1/apex` returns the env apex (this unblocks US1's wizard-skip). Add `SUPASTACK_APEX` to the worker compose env.
- **US1 (P1)** — `Setup.tsx`: remove the `enter-apex` sub-state + `apexInput` + the `orgApi.patch({apexDomain})` write; land directly on the DNS-records step using the env-backed apex; block (per clarification) when the apex is local/default. Drop `apexDomain` from the Setup + Org request schemas (`@supastack/shared`) and the web `api.ts` body types.
- **US2 (P2)** — `install.sh`: domain capture resolves `$1` → `SUPASTACK_APEX` env → existing `.env` → interactive prompt **via `/dev/tty`** (so `curl | bash` prompts) → warned `localhost` only when no domain and no TTY. Persist to `.env`.
- **US3 (P3)** — repoint the remaining ~18 DB readers to `getApex()`; remove the `apexDomain` write in `setup.ts` + `org.ts`; delete `apex-resolver.ts`; drop the column via migration `0024` + remove it from the Drizzle schema; add the contract test that no `installation.apexDomain` reference remains.
- **Polish** — unit tests (accessor, local gate, prompt ordering), contract test, web build/lint, live-VM smoke.

## Complexity Tracking

*No violations — table intentionally empty.*
