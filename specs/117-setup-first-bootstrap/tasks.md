# Tasks: Single-Source Apex — domain set once at install, `/setup` guides DNS

**Feature**: 117 · **Branch**: `117-setup-first-bootstrap` · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

**Inputs**: research.md, data-model.md, contracts/{apex-source,setup-and-org-api,installer-prompt}.md, quickstart.md

**Tests**: included (spec Independent Tests + SC + Constitution VI: security/correctness-sensitive logic gets unit + contract tests).

**Conventions**: `[P]` = parallelizable (different files, no incomplete dep). `[USn]` = user-story phase. Paths are exact.

---

## Phase 1: Setup

- [x] T001 Create the single apex accessor `packages/shared/src/apex.ts` exporting `getApex(): string | null` (reads `process.env.SUPASTACK_APEX ?? null`), `getApexOrThrow(): string` (throws if unset/empty), `isRealApex(apex): boolean` (true iff set, `!== 'localhost'`, contains `.`); export all three from `packages/shared/src/index.ts`.

---

## Phase 2: Foundational (blocking prerequisites)

**Goal**: env-backed apex everywhere the wizard + cleanup depend on. Blocks US1 (env-backed `/apex`) and US3 (accessor used by all readers).

- [x] T002 [P] Unit test `packages/shared/tests/apex.test.ts` — `getApex` (set/unset → value/null), `getApexOrThrow` (throws when unset), `isRealApex` (`supaviser.dev`→true; `localhost`/`''`/`null`/`myhost`(no dot)→false).
- [x] T003 Repoint `apps/api/src/routes/apex.ts` (`:35`, `:98`) from `db().select({apex: installation.apexDomain})` to `getApex()`, so `GET /api/v1/apex` is env-backed (returns the apex on a configured install → wizard auto-skips the input).
- [x] T004 Repoint the apex-status helper in `apps/api/src/server.ts` (`:464`, `:483`) to `getApex()`.
- [x] T005 Add `SUPASTACK_APEX: ${SUPASTACK_APEX:?SUPASTACK_APEX required}` to the **worker** service env in `infra/docker-compose.yml` (worker reads the apex in `provision.ts`/`pooler-reconciler.ts` but has no such env today — required before the column drop).

**Checkpoint**: `GET /api/v1/apex` returns the env apex with no DB column read; worker has the env var.

---

## Phase 3: User Story 1 — `/setup` guides DNS instead of re-asking the domain (Priority: P1) 🎯 MVP

**Goal**: the wizard reads the established domain and lands on the DNS-records step; no domain input; blocks on a local/default domain.

**Independent test**: open `/setup` with a domain established → no domain-entry field; DNS records shown for the established domain; on a `localhost` install → blocked with a "set a real domain at install" message.

- [x] T006 [US1] In `apps/web/src/pages/Setup.tsx`, remove the `enter-apex` sub-state, the `apexInput` state, and the `saveApex`/`orgApi.patch({apexDomain})` write; have `DomainCertsStep` read the env-backed apex from `apexApi.status()` and start at `verifying-dns` (initiate the wildcard order directly). Ensure the DNS-records step renders **all three records required by FR-006** — the apex A record, the wildcard `*.<apex>` A record, and the ACME TXT challenge — adding the wildcard-A guidance if the existing step surfaces only the TXT + resolution status.
- [x] T007 [US1] In `apps/web/src/pages/Setup.tsx`, add the local/default-domain block: when `isRealApex(apex)` is false, render a blocking message ("You're on a local/default domain — re-run the installer with a real domain to enable HTTPS") with no DNS records, no cert attempt, and no input. Import the **pure** `isRealApex` from `@supastack/shared` (already a web dependency); do **not** call `getApex()` in the browser (no `process.env`) — the apex comes from `apexApi.status()`. If the shared barrel pulls node-only code into the Vite bundle, inline the one-line check instead.
- [x] T008 [P] [US1] In `apps/web/src/lib/api.ts`, drop `apexDomain` from the `setupApi.run` body type (`:57`) and the `orgApi.patch` body type (`:116`).
- [x] T009 [P] [US1] Web unit test `apps/web/tests/unit/setup-domain-gate.test.ts` — asserts (a) no domain-entry field renders when an apex is established, and (b) the blocking state renders when the apex is local/default (`localhost`/empty).

**Checkpoint**: US1 is independently shippable — operator-visible #110 fix (wizard no longer asks for the domain). Backend still tolerates an unused `apexDomain` field until US3.

---

## Phase 4: User Story 2 — Reliable install-time domain capture (Priority: P2)

**Goal**: the installer captures the domain however it's launched (file, `curl | bash`, arg, env); never a silent `localhost`.

**Independent test**: run four ways (file+prompt, `curl|bash` still prompts, positional arg, env) → same `.env` value; piped with no domain + no TTY → `localhost` **with a warning**.

- [x] T010 [US2] In `install.sh`, factor a pure `resolve_apex` helper and wire domain capture to priority order **arg `$1` → `SUPASTACK_APEX` env → existing `.env` → interactive prompt read from `/dev/tty` → warned `localhost`**; add the positional-arg form (`./install.sh supaviser.dev`); emit a visible warning on the `localhost` fallback; persist to `$INSTALL_DIR/.env` (never a shell rc).
- [x] T011 [P] [US2] Test the resolution-order logic (`tests/installer/resolve-apex.test.mjs` or bats) — arg>env>dotenv>prompt>localhost ordering, and the `curl|bash` case (stdin not a TTY but `/dev/tty` readable → prompt fires, not silent localhost).

**Checkpoint**: US2 is fully independent of US1/US3 — can land in any order.

---

## Phase 5: User Story 3 — One value everywhere, drop the column, remove dead path (Priority: P3)

**Goal**: every reader resolves env; the duplicate DB column + writes + dead resolver are gone; structurally enforced.

**Independent test**: every domain reader resolves the same env value; the `apex_domain` column no longer exists and nothing reads/writes it; `apex-resolver` is gone; the contract test passes.

- [x] T012 [US3] Repoint the api **route** readers to `getApex()`: `apps/api/src/routes/wildcard-certs.ts` (`:21,44,73,127`), `tls-ask.ts` (`:45`), `connect-cli.ts` (`:29`), `instances.ts` (`:73`), `pooler-status.ts` (`:68`), `admin.ts` (`:19`), `pg-edge-cert-internal.ts` (`:21`).
- [x] T013 [US3] Repoint the api **service** readers to `getApex()`: `apps/api/src/services/caddy-config.ts` (`:30`, routing config) and `apps/api/src/services/pooler-tenants.ts` (`:27`).
- [x] T014 [P] [US3] Repoint the **worker** readers to `getApex()`: `apps/worker/src/jobs/provision.ts` (`:63`) and `apps/worker/src/services/pooler-reconciler.ts` (`:225`).
- [x] T015 [US3] In `apps/api/src/routes/setup.ts` (`:61,64`), stop writing `apexDomain` in the `installation` upsert (still upsert the singleton for its other fields).
- [x] T016 [US3] In `apps/api/src/routes/org.ts`, remove all apex handling from `PATCH /api/v1/org`: the **`existing` compare-select `db().select({apex: installation.apexDomain})` (`:40-41`)** and its `existing.apex` comparison, the body handling (`:45-48`), the apex-change reload trigger (`:61-…`), and the response projection (`:19,71`). The reload-on-apex-change path is removed entirely (apex no longer changes via this endpoint — FR-014).
- [x] T017 [US3] Remove `apexDomain` from the Setup body schema (`:24`) and the Org patch schema (`:112`) in `packages/shared/src/schemas.ts`. (Sequence after US1 so the frontend no longer sends it.)
- [x] T018 [P] [US3] Delete `apps/api/src/services/apex-resolver.ts` (the unreachable two-source `resolveApex`, FR-013).
- [x] T019 [US3] **Last data change** — after T012–T017: remove the `apexDomain: text('apex_domain').unique()` line from `installation` in `packages/db/src/schema/identity.ts` (`:46`) and add migration `packages/db/migrations/0024_drop_installation_apex_domain.sql` = `ALTER TABLE installation DROP COLUMN IF EXISTS apex_domain;` (idempotent, explicitly destructive).
- [x] T020 [US3] Migrate existing tests that reference the dropped column/resolver so the suite stays green (same change-set as T012–T019, before the contract test): **DELETE** `apps/api/tests/unit/apex-resolver.test.ts` (tests the removed resolver); switch the apex source from a mocked `installation.apexDomain` to `process.env.SUPASTACK_APEX` (stub `getApex`) in `apps/api/tests/unit/caddy-config-setup-gate.test.ts`, `caddy-config-api-host.test.ts`, `caddy-config-layer4.test.ts`, `caddy-config-docs-admin.test.ts`, `admin-routes.test.ts`, and `apps/api/tests/integration/connect-cli/profile-toml.test.ts`; drop `apexDomain` from the request body + assertions in `apps/api/tests/contract/setup.test.ts`.
- [x] T021 [US3] Contract test `apps/api/tests/contract/no-apex-domain-reader.test.ts` — fails if any production source under `apps/*/src` or `packages/*/src` references `installation.apexDomain` / `schema.installation.apexDomain` / `apex_domain`, or imports `apex-resolver` (allow: migration SQL, specs, tests).

**Checkpoint**: single source enforced by construction; #110 closed.

---

## Phase 6: Polish & cross-cutting

- [x] T022 [P] `pnpm -w build && pnpm -w lint` clean (web wizard trimmed, shared schema/accessor, worker compile, no dangling `apexDomain` refs).
- [x] T023 [P] Migration idempotency: apply `0024` twice against a scratch DB → second run is a no-op (Constitution I).
- [ ] T024 Live-VM smoke on supaviser.dev (quickstart): `/api/v1/apex` env-backed; `/setup` shows no domain input + lands on DNS step; Caddy routing + the 3 projects + a per-instance subdomain still resolve after the column drop (caddy-config reads env); a worker provision/pooler cycle builds correct `<ref>.supaviser.dev`; `curl|bash` install prompts (no silent localhost). Deploy = migration on `api` boot + rebuild `api`+`worker`+`web`+`packages`; **recreate** `worker` for the new env.  ⟵ requires a live deploy (operator-run)
- [x] T025 [P] Runbook `docs/changes/117-single-source-apex.md` (what changed, the worker-env gotcha, deploy/rollback).

---

## Dependencies

- **Setup (T001)** → blocks everything (the accessor).
- **Foundational (T002–T005)** → blocks US1 (T003 env-backed `/apex`) and US3 (accessor + worker env).
- **US1 (T006–T009)** → depends on Foundational; independently shippable (MVP).
- **US2 (T010–T011)** → independent of US1/US3 (touches only `install.sh`); can run anytime after Setup.
- **US3 (T012–T021)** → depends on Foundational; internal order: repoint readers (T012–T014) + remove writes (T015–T016) + schema field (T017, after US1) → **then** column drop (T019) → migrate existing tests (T020, same change-set) → then contract test (T021). T018 (delete resolver) any time in US3; **T020 must precede T021 and T022 (build/lint)**.
- **Polish (T022–T025)** → after the stories it verifies.

## Parallel execution examples

- Foundational: **T002** (accessor test) ∥ **T003/T004** (different files) ∥ **T005** (compose).
- US1: **T008** (web types) ∥ **T009** (web test) while **T006/T007** edit `Setup.tsx`.
- US3 repoint: **T014** (worker) ∥ **T012/T013** (api) ∥ **T018** (delete resolver). Then T015/T016/T017 → T019 → T020 → T021.
- Polish: **T022** ∥ **T023** ∥ **T025**.

## Implementation strategy

- **MVP = Setup + Foundational + US1** → the operator-visible #110 fix: `/setup` stops asking for the domain and guides DNS for the env-established apex (blocking on local). Ships without touching the DB.
- **US2** can land in parallel at any point (pure installer hardening).
- **US3** delivers the structural close (drop the column, repoint all readers, delete dead code, contract-test the invariant). The migration is the final, lowest-risk-ordered change — every reader/writer is repointed first.
- **Deploy**: one migration (idempotent/destructive), rebuild `api`+`worker`+`web`+`packages`; **recreate** the worker for the new `SUPASTACK_APEX` env. No `/v1` change, no Studio rebuild, no new dependency.
