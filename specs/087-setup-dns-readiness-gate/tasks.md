---
description: "Task list — feature 087 setup wizard DNS-readiness gate (fix #94)"
---

# Tasks: Setup wizard DNS-readiness gate — trust the authoritative backend signal (fix #94)

**Input**: Design documents from `specs/087-setup-dns-readiness-gate/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/dns-ready-signal.md, quickstart.md

**Tests**: INCLUDED — the spec's US1/US2 Independent-Test sections call for unit coverage; operator preference is happy + sad path. Backend `allDnsReady` guard test + frontend gate-logic test.

**Organization**: by user story (US1 correctness P1; US2 cleanup P2). No migration, no new dependency, no new endpoint. ~2 source files (`apps/api` signal + `apps/web` gate) + 2 unit tests + lint.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete deps).
- Paths are repo-relative.

---

## Phase 1: Setup (baseline)

- [X] T001 Confirm on branch `087-setup-dns-readiness-gate` (rebased onto `supastack-rewrite`); capture a green baseline: `pnpm --filter @supastack/web build`, `pnpm --filter @supastack/web test`, `pnpm --filter @supastack/api test`, `pnpm lint` — record the pre-change `eslint-disable`/`TODO(#94)` lines in `apps/web/src/pages/Setup.tsx` (L217-219) so US2 removal is verifiable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**None.** US1 and US2 are independent of any shared scaffolding; US1's backend signal and frontend gate are themselves the foundational change.

---

## Phase 3: US1 — The gate unlocks cert creation exactly when DNS is actually ready (Priority: P1)

**Goal**: the "Create Certs" gate is driven by the authoritative backend `allDnsReady` (with the empty-list guard), not the brittle client recount.
**Independent test**: quickstart §1–§2 — backend guard unit (empty→false), frontend gate unit (open only when A-records ok AND `allDnsReady===true`); live wizard enables within one poll once records propagate and never gets stuck on challenge-refresh.

- [X] T002 [US1] Add the empty-list guard to the authoritative signal in BOTH sources so it can't drift: `apps/api/src/routes/wildcard-certs.ts` (~L81) and `apps/api/src/services/acme.ts` (~L189) — change `allDnsReady = dnsChecks.every((c) => c.found)` to `allDnsReady = dnsChecks.length > 0 && dnsChecks.every((c) => c.found)` (FR-002). No response-shape change (contracts/dns-ready-signal.md).
- [X] T003 [P] [US1] Backend unit test `apps/api/tests/unit/dns-ready-signal.test.ts` — assert the `allDnsReady` rule: **sad** empty `dnsChecks` → `false` (the `[].every()` trap), **sad** any record `found:false` → `false`; **happy** non-empty + all `found:true` → `true`. Extract/exercise the computation as a pure helper if needed to keep the test pure.
- [X] T004 [US1] Repoint the gate in `apps/web/src/pages/Setup.tsx` (~L230): `const allDnsResolved = apexDnsOk && wildcardDnsOk && allTxtFound` → use the authoritative `allTxtReady` (sourced from `cert.allDnsReady ?? false`, already set at L263/L292). Keep the apex+wildcard A-record terms unchanged (FR-004); the gate must default closed on missing/undefined signal (FR-006). (Optional: rename `allTxtReady`→`dnsReady` for clarity.)
- [X] T005 [P] [US1] Frontend unit test `apps/web/tests/unit/setup-dns-gate.test.tsx` — gate logic: **happy** `apexDnsOk && wildcardDnsOk && allDnsReady===true` → open; **sad** `allDnsReady` `false`/`undefined`/absent with A-records ok → closed; **sad** A-records not ok with `allDnsReady===true` → closed. (Pure logic — extract the gate predicate if needed so it can be unit-tested without rendering the full wizard.)
- [ ] T006 [US1] LIVE VERIFY (quickstart §4; deploy-gated, operator-run on a throwaway domain): fresh `/setup` — pre-DNS button **disabled** ("Waiting for DNS…"); publish apex A + wildcard A + `_acme-challenge` TXT → button **enables within one poll** with no workaround (SC-001); trigger a challenge re-issue mid-session → gate tracks current records, never permanently stuck (SC-003).

**Checkpoint**: gate correctness fixed + unit-proven; backend signal authoritative (non-vacuous).

---

## Phase 4: US2 — Remove the dead recount + clear the lint suppression (Priority: P2)

**Goal**: no unused variable, no `eslint-disable`, no `#94` TODO in the wizard.
**Independent test**: quickstart §3 — `pnpm lint` clean + grep finds none of `allTxtFound` / `TODO(#94)` / `eslint-disable` in `Setup.tsx`.

- [X] T007 [US2] In `apps/web/src/pages/Setup.tsx`: delete the brittle `allTxtFound` recount (~L227) and the `TODO(#94)` comment + `// eslint-disable-next-line @typescript-eslint/no-unused-vars` (~L217-219); `allTxtReady` is now the live gate input from T004 (no longer dead). Remove any now-unused supporting state. (Depends on T004 — same file; do after the repoint.)
- [X] T008 [P] [US2] Verify cleanup (SC-004): `pnpm lint` green (0 unused-var in the wizard, no `eslint-disable` covering the gate); `grep -nE "allTxtFound|TODO\(#94\)|eslint-disable" apps/web/src/pages/Setup.tsx` → no matches.

**Checkpoint**: wizard area is lint-clean; the #94 trigger is gone.

---

## Phase 5: Polish & Cross-Cutting

- [X] T009 [P] Add a short runbook `docs/changes/087-setup-dns-readiness-gate.md` (the staleness bug, the gate repoint, the `[].every()` empty-guard rationale, FR-007 no-browser-DNS) and flip the `CLAUDE.md` active-feature status → implemented once green.
- [X] T010 Final gate: `pnpm --filter @supastack/web build` + `pnpm --filter @supastack/web test` + `pnpm --filter @supastack/api test` (signal test) + `pnpm lint` all green; quickstart §1–§3 pass. Close #94 on merge.

---

## Dependencies & parallelism

- **US1 internal**: backend (T002 + T003) is independent of frontend (T004 + T005) → the two pairs run in parallel. T003 ∥ T002 done; T005 ∥ T004 done.
- **US2**: T007 depends on T004 (same file `Setup.tsx`; repoint before removing). T008 after T007.
- **T006** (live wizard) is deploy-gated — operator-run after T002+T004 land.
- **MVP = US1** (the user-facing correctness fix). US2 is the code-health follow-on; both touch `Setup.tsx` and ship together in practice.

### Parallel example (US1)
```
# after T001:
T002 (backend guard)      ┐
T003 (backend test)  [P]  ├─ parallel with ─┐
T004 (frontend gate)      ┘                 │
T005 (frontend test) [P] ─────────────────── ┘
# then US2: T007 → T008 ; Polish: T009 [P], T010
```

**Total: 10 tasks** — Setup 1, US1 5 (incl. 2 tests + 1 live), US2 2, Polish 2.
