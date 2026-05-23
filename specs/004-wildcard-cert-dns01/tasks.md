# Tasks: Wildcard TLS Cert via DNS-01

**Input**: Design documents from `specs/004-wildcard-cert-dns01/`

**Feature**: Manual DNS-01 wildcard cert via `acme-client` npm + Caddy `tls.certificates.load_files`

**Reference implementation**: `open-frontend/apps/api/src/services/acme-manual.ts` + `open-frontend/apps/edge/src/reload.ts`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency conflicts)
- **[US1]**: Wildcard cert issuance during /setup wizard
- **[US2]**: VM reset + re-setup verification + renewal alert

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add `certs-data` volume, install `acme-client` dep. Unblocks all subsequent work.

- [X] T001 Add `certs-data` Docker volume to `infra/docker-compose.yml`
- [X] T002 [P] Add `acme-client` npm dependency to `apps/api/package.json` and run `pnpm install`

---

## Phase 2: Foundational (Blocking Prerequisites)

- [X] T003 Create `packages/db/migrations/0003_wildcard_cert.sql`
- [X] T004 [P] Create `packages/db/src/schema/tls.ts`
- [X] T005 Export new schema in `packages/db/src/schema/index.ts`
- [X] T006 [P] Add Zod types to `packages/shared/src/schemas.ts`

---

## Phase 3: User Story 1 — Issue Wildcard Certificate During /setup (Priority: P1) 🎯 MVP

### Backend — ACME Service

- [X] T007 [US1] Create `apps/api/src/services/acme.ts`

### Backend — Caddy Config

- [X] T008 [US1] Edit `apps/api/src/services/caddy-config.ts`

### Backend — Routes

- [X] T009 [US1] Create `apps/api/src/routes/wildcard-certs.ts`
- [X] T010 [P] [US1] Edit `apps/api/src/routes/org.ts` — add `hasCert` field
- [X] T011 [US1] Edit `apps/api/src/server.ts` — register wildcard-certs routes

### Frontend — API Client

- [X] T012 [P] [US1] Edit `apps/web/src/lib/api.ts` — add `wildcardCertApi`

### Frontend — Components

- [X] T013 [P] [US1] Create `apps/web/src/components/WildcardCertCard.tsx`

### Frontend — Setup Wizard Step 4

- [X] T014 [US1] Edit `apps/web/src/pages/Setup.tsx` — add Step 4 wildcard-cert

---

## Phase 4: User Story 2 — VM Reset + Renewal Alert (Priority: P1)

### Backend — Cert-Check BullMQ Job

- [X] T015 [US2] Create `apps/api/src/services/cert-check.ts`
- [X] T016 [US2] Edit `apps/api/src/server.ts` — schedule cert-check job

### Frontend — Renewal Banner

- [X] T017 [P] [US2] Add renewal alert banner to `apps/web/src/components/Shell.tsx`

### Validation — VM Reset Smoke Test

- [X] T018 [US2] Create `docs/vm-reset.md`

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T019 [P] API typecheck passes for `caddy-config.ts` backward compat (verified via `pnpm typecheck`)
- [X] T020 [P] Renewal banner wired in `Shell.tsx` for all dashboard pages
- [X] T021 [P] Create `docs/wildcard-tls.md` — operator documentation
- [X] T022 Create `infra/.env.example` with `ACME_DIRECTORY_URL` documented

---

## All 22 tasks complete ✓
