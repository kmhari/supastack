# Implementation Plan: Setup wizard DNS-readiness gate — trust the authoritative backend signal (fix #94)

**Branch**: `087-setup-dns-readiness-gate` | **Date**: 2026-06-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/087-setup-dns-readiness-gate/spec.md`

## Summary

The `/setup` wizard's "Create Certs" gate keys off a brittle, captured-once **client-side recount** (`allTxtFound`) of DNS-record readiness, while the **authoritative backend signal** (`cert.allDnsReady`, derived from public-resolver lookups) is already fetched into `allTxtReady` but never read (silenced with an `eslint-disable` + `TODO(#94)`). Fix (issue #94 Option A): point the gate at the backend signal and delete the dead recount + suppression. One backend correction is required — `allDnsReady = dnsChecks.every(c => c.found)` is **vacuously `true` for an empty `challengeRecords`** (`[].every() === true`), so the signal gets an empty-list guard at its source so it is never falsely "ready" (FR-002). No new dependencies, no migration, no new endpoint.

## Technical Context

**Language/Version**: TypeScript 5.x (React 18 frontend; Node 20 Fastify backend)

**Primary Dependencies**: `apps/web` (Vite + React) — `Setup.tsx`, `lib/api.ts`; `apps/api` — `routes/wildcard-certs.ts`, `services/acme.ts` (`checkDns` via public DNS resolvers). No new deps.

**Storage**: N/A (no DB read/write changed; `wildcard_certs.challengeRecords` is read-only here)

**Testing**: Vitest unit (`apps/web/tests/unit` for the gate logic; `apps/api/tests/unit` for the `allDnsReady` empty-guard), `pnpm lint` for the suppression-removal acceptance (US2)

**Target Platform**: Browser (setup wizard) + control-plane api

**Project Type**: Web application (existing `apps/web` SPA reduced to `/setup` by feature 086 + `apps/api`)

**Performance Goals**: gate flips within one existing poll cycle (no new polling/latency)

**Constraints**: MUST NOT introduce any browser-side DNS or apex lookup (negative-cache risk, FR-007); fail-safe — gate stays closed when the signal is absent/errors (FR-006)

**Scale/Scope**: ~2 source files (`Setup.tsx` gate + the backend `allDnsReady` guard), first-install-only path

## Constitution Check

*GATE: Must pass before Phase 0. Re-checked after Phase 1.*

| Principle | Applies? | Assessment |
|---|---|---|
| I. Idempotent, additive migrations | No | No DB migration. |
| II. Secrets encrypted, master key home | No | No secrets touched. |
| III. Authorize every privileged action | No | `/wildcard-certs/status` is an unauthenticated **first-install** endpoint (no operator exists yet); this feature changes its computation, not its auth posture. No new action. |
| IV. Supabase compatibility pinned contract | No | Not a `/v1/*` Management endpoint; `/api/v1/wildcard-certs/*` is dashboard-internal. No upstream contract. |
| V. Worker owns per-instance state | No | No worker job; `checkDns` already runs inline in the status handler (unchanged). |
| VI. Spec-driven, evidence-based | **Yes** | Spec present; the fix is guarded by a frontend gate unit test + a backend empty-guard unit test + a lint check (US2). Outcomes reported with test/lint evidence. |

**Result: PASS** — no violations; no Complexity Tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/087-setup-dns-readiness-gate/
├── plan.md              # This file
├── research.md          # Phase 0 — the 3 design decisions
├── data-model.md        # Phase 1 — gate condition + signal semantics (no entities)
├── quickstart.md        # Phase 1 — verification scenarios (maps SC-001..005)
├── contracts/
│   └── dns-ready-signal.md   # /wildcard-certs/status `allDnsReady` semantics
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
apps/
  api/src/
    routes/wildcard-certs.ts     # GET /wildcard-certs/status (~L81): add empty-list guard to allDnsReady
    services/acme.ts             # (~L189): same allDnsReady computation — guard for consistency
  web/src/
    pages/Setup.tsx              # gate (L230) consumes allTxtReady; remove allTxtFound recount + TODO/eslint-disable (L217-227)
    lib/api.ts                   # WildcardCertStatus.cert.allDnsReady type (already present) — no change expected
  api/tests/unit/                # new: allDnsReady empty-guard test (length>0 && every-found)
  web/tests/unit/                # new: gate logic test (ready iff apex+wildcard A resolve AND allDnsReady)
```

**Structure Decision**: Existing `apps/web` (frontend wizard) + `apps/api` (status signal). The fix is a **2-file behavioral change** (backend signal guard + frontend gate source) plus dead-code/lint removal; no new modules, services, or packages.

## Complexity Tracking

None — Constitution Check passes with no violations.
