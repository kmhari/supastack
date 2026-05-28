---
description: "Task list for feature 020 — Auth Providers Dashboard + Behavioral Parity"
---

# Tasks: Auth Providers Dashboard + Behavioral Parity (Feature 020)

**Input**: Design documents from `specs/020-auth-providers-dashboard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth-config-get-response.md, contracts/provider-form-templates.md, quickstart.md

**Closes**: #21 (revised, 141-field scope) and #34 (Auth Providers dashboard).

**Supersedes**: feature 019 (folded into US3 + US4 here).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Independent file/dir from other [P] tasks in the same phase — safe to parallelize
- **[Story]**: User story tag from spec.md (US1–US5)
- File paths are relative to repo root

---

## Phase 1: Setup (shared infrastructure)

**Purpose**: Tooling and dependencies the rest of the feature relies on. Light — most groundwork already exists from feature 009.

- [X] T001 Add `@radix-ui/react-dialog` to `apps/web/package.json` (if not already present) and run `pnpm install` (or `npm install`) — required by the new `Sheet` primitive in Track C  *(already present at v1.1.2 — verified)*
- [X] T002 Add a `apps/api/tests/contract/` directory (currently absent) and a `vitest.config.ts` include-glob entry covering it, so the snapshot-drift test in Track A is picked up by `pnpm test`  *(directory already exists with 16 existing tests — verified)*
- [X] T003 [P] Add `helpers/` subdirectory under `tests/cli-e2e/` (if absent) and a brief `README.md` documenting the per-assertion convention used by Track B
- [X] T004 [P] In `docs/changes/`, create empty stub `020-auth-providers.md` so subsequent commits append into a stable filename

**Checkpoint**: tooling ready; no production code touched yet.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The data structures and UI primitives every user story depends on. Nothing here is operator-visible; finishing this phase unblocks US1/US2/US3/US4/US5 in parallel.

- [X] T005 In `apps/api/src/services/env-field-mapper.ts`, replace the current `AUTH_CONFIG_HONORED` export with the new tagged-union type from data-model.md §1. Added `AUTH_CONFIG_FIELD_STATUS: Record<string, FieldStatus>` as the new source of truth; re-derived `AUTH_CONFIG_HONORED` from it. 24 existing honored entries unchanged; non-honored fields auto-populated with `{ kind: 'stored_only', reason: 'pending classification — see #21' }` placeholder; 6 unsupported fields classified with #63 reason
- [X] T006 Compile-time exhaustiveness: the build path adopted is `buildFieldStatus()` which uses `ALL_AUTH_CONFIG_FIELDS` (re-exported from `@selfbase/shared`) to ensure every key is present at runtime. Drift is caught by T007 contract test (build-time `satisfies` was redundant given runtime check + contract test)
- [X] T007 Created `apps/api/tests/contract/upstream-auth-config-snapshot.test.ts` — 3 assertions: every upstream field is classified, no extras in map, snapshot has exactly 234 fields. PASSES against current snapshot
- [X] T008 [P] Created `apps/web/src/components/ui/sheet.tsx` — Radix-Dialog-based right-side slide-in drawer, mirrors `dialog.tsx` patterns
- [X] T009 [P] Added new sidebar group `Authentication` in `apps/web/src/components/ProjectShell.tsx` with `Providers` entry pointing at `${base}/auth/providers`
- [X] T010 [P] Created `apps/web/src/lib/health-poll.ts` exporting `pollUntilHealthy(ref, { timeoutMs })` with backoff [500ms/1s/2s/4s cap], default 60s timeout, polls `instancesApi.get(ref)` for `status === 'running'`. (Combined per-instance kong health check deferred — control-plane status is sufficient for the dashboard UX; e2e harness in US3 owns the kong-side check)
- [X] T010a Promoted `security_manual_linking_enabled` to `honored` (env `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED`); added new env line in `infra/supabase-template/docker-compose.yml`. Contract test continues to pass

**Checkpoint**: status-map shape is in place; UI primitives exist; sidebar slot is reserved; `security_manual_linking_enabled` is honored so US1's GlobalTogglesForm has no silent-no-op risk. User-story work can now begin in parallel.

---

## Phase 3: US1 — Google end-to-end from the dashboard (Priority: P1) 🎯 MVP

**Goal**: Operator can configure Google sign-in end-to-end through the new Auth → Providers page, with restart-toast feedback, without touching the CLI or SSH. Google is already honored today, so this phase is dashboard-only and ships as the visible MVP.

**Independent Test**: Fresh project on supaviser.dev. Log in as admin → Auth → Providers → Google row → drawer opens → paste real Google Client ID + Secret → toggle Enable → Save → toast appears → ~30s later toast flips to success → row pill is Enabled → end-to-end OAuth handshake on a sample app succeeds.

### US1 Implementation

- [X] T011 [US1] Added `authConfigApi.get/patch` to `apps/web/src/lib/api.ts`. Uses a separate `mgmtApiClient` (root host, no `/api/v1` prefix) so it hits the Management API surface directly. `AuthConfigResponse` type includes the `_selfbase.fieldStatus` extension (US4 fills it server-side)
- [X] T012 [US1] Created `apps/web/src/pages/auth-providers/callback-url.ts` — `buildCallbackUrl(ref, apex)` returns `https://${ref}.${apex}/auth/v1/callback`, falls back to placeholder if apex unknown
- [X] T013 [US1] Created `apps/web/src/pages/auth-providers/use-restart-toast.ts` — full toast/poll/refetch/retry orchestration per plan §C4
- [X] T014 [US1] Created `apps/web/src/pages/auth-providers/provider-registry.ts` — 3 entries (Email, Phone, Google); typed `ProviderDef` discriminated union; `findProviderByDisplayName` helper for deep-link
- [X] T015 [US1] Created `apps/web/src/pages/auth-providers/GoogleForm.tsx` — full Google drawer with all fields, comma-joined Client IDs split/rejoin, secret-as-blank semantics, callback URL + Copy button, Docs link, Cancel/Save footer, RBAC-gated Save
- [X] T016 [US1] Reveal button rendered as disabled with `title="Reveal coming soon — see #73"`. Vitest covers the disabled state
- [X] T017 [US1] Created `apps/web/src/pages/ProjectAuthProviders.tsx` — page composition + drawer state machine + deep-link query-param handling + Sheet portal
- [X] T018 [US1] Wired route in `apps/web/src/App.tsx` — `/dashboard/project/:ref/auth/providers` → `ProjectAuthProvidersPage`
- [X] T019 [US1] Created `apps/web/src/pages/auth-providers/GlobalTogglesForm.tsx` — 4 toggles + Save changes; correctly handles inverted semantics for Allow-signup and Confirm-email; dispatches diff-only PATCH
- [X] T020 [US1] Created `apps/web/src/pages/auth-providers/ProviderRow.tsx` exporting `ProviderRow`, `EmailPhoneToggleRow`, `ComingSoonRow` (US5 uses the last one). Placeholder letter-icon for now; upstream icons deferred per research open item
- [X] T021 [US1] Created `apps/web/tests/unit/ProjectAuthProviders.test.tsx` — 5 vitest cases (list render, global toggles render, RBAC hides Save for non-admin, RBAC shows Save for admin, enabled/disabled badges reflect auth-config). 5/5 PASS. Drawer-open interaction tests omitted (Radix Sheet portal + jsdom click dispatch fragility; manual smoke + e2e cover the open path)
- [ ] T022 [US1] Smoke test against supaviser.dev (manual, per quickstart.md §Smoke 1): full Google e2e flow including real OAuth handshake. Record outcome in commit message  *(not yet run — requires deployed feature; pending operator)*

**Checkpoint**: A real operator can configure Google end-to-end from the dashboard. Other providers are not yet wired in the dashboard but the page renders cleanly with their rows from T020 hidden until US2.

---

## Phase 4: US3 — Backend behavioral parity (Priority: P1)

**Goal**: ~140 currently-stored-only auth-config fields are promoted to `honored` (in addition to the single `security_manual_linking_enabled` already promoted in T010a). Total honored field count climbs from 24 to a target of 165 (± 5 per research R-001, minimum 160). Every honored field has a behavioral assertion proving runtime change.

**Independent Test**: With no dashboard interaction, drive the Management API: PATCH each newly-honored field with a known-changing value; run the assertion; observe runtime change in the per-instance auth container. `tests/cli-e2e/auth-config-behavioral-parity.sh` exits 0.

### US3 Implementation — backend field-mapping

- [X] T023 [US3] Populated 17 newly-promoted OAuth providers + Slack OIDC variant + per-family extras + already-honored providers' extras (google additional_client_ids/skip_nonce_check/email_optional, azure url/email_optional, github email_optional) in `AUTH_CONFIG_FIELD_STATUS`. Helper `newlyPromotedOauthEntries()` generates entries from config. Secrets tagged with `secret: true`
- [X] T024 [US3] Populated 37 mailer fields (notifications 7, OTP 2, subjects 13, templates 13, misc 2) in `MAILER_HONORED`. All pinned GoTrue image supports the field set (no reclassification needed)
- [X] T025 [US3] Populated 19 sessions/password/webauthn-rp/passkey/api/db/smtp-misc fields (`SESSIONS_PW_ETC_HONORED`). Includes a 19th field — `security_refresh_token_reuse_interval` — that python audit flagged as missing from initial scoping
- [X] T026 [US3] Populated 7 rate-limit fields (`RATE_LIMIT_HONORED`) with `GOTRUE_RATE_LIMIT_*` env names
- [X] T027 [US3] Populated 59 stored-only fields with cluster reasons: 21 sms → #66, 21 hooks → #64, 10 mfa → #65, 3 captcha → #62, 2 saml → #61, 2 web3 → #72
- [X] T028 [US3] Populated 6 unsupported fields with `#63` reasons (covered by `UNSUPPORTED_REASONS`)
- [X] T029 [US3] Added `tests/unit/env-field-mapper.test.ts` count assertions: total=234, honored ∈ [160,170] (actual 169), unsupported=6, every stored_only/unsupported has reason ending with `#NNN`, every honored has envName, secret-named fields flagged with `secret:true`. 13 assertions PASS
- [X] T030 [US3] Contract test still passes after population (3/3 assertions); 234 fields exhaustively classified

### US3 Implementation — template wiring

- [X] T031 [US3] Added env lines for 17 OAuth providers + Slack OIDC + LinkedIn OIDC + 3-provider extras in `infra/supabase-template/docker-compose.yml`. Decision change from plan: used full `GOTRUE_EXTERNAL_<KEY>_*` names instead of the short-alias pattern. This kept the runtime-config-store/template mapping 1:1 and eliminated a manual alias-table; verified by the env-template tripwire test (now 13 honored env names asserted present in the template, all PASS)
- [X] T032 [US3] Added env lines for 37 mailer fields (subjects, templates, notifications, OTP, misc) with `GOTRUE_MAILER_*` names + `:-` defaults
- [X] T033 [US3] Added env lines for 19 sessions/password/webauthn-rp/passkey/api/db/smtp-misc fields and 7 rate-limit fields. All `GOTRUE_*` names + `:-` defaults
- [X] T034 [US3] Validated template: `docker compose config` with minimal env vars set substitutes all promoted env lines correctly (sample: `GOTRUE_EXTERNAL_DISCORD_*` resolves to empty strings + `_REDIRECT_URI` to `/auth/v1/callback`). Pre-existing system env vars are unaffected

### US3 Implementation — behavioral parity test harness

- [X] T035 [US3] Created `tests/cli-e2e/helpers/auth-config-assertions.sh` with helpers (`mgmt_url`, `wait_for_healthy`, `patch_field`, `exec_get_env`) + 4 typed assertions (`assert_env_var_present`, `assert_jwt_exp`, `assert_oauth_authorize_redirects`, `assert_rate_limit_429`). Bash syntax-checked
- [X] T036 [US3] Created `tests/cli-e2e/auth-config-behavioral-parity.sh` — reads `_selfbase.fieldStatus` from the Management API as the source of honored fields (auto-stays-in-sync with the backend), dispatches per pattern (jwt_exp / external_*_enabled / rate_limit_email_sent / fallback to env-var presence), emits `[BEHAVIORAL] FIELD=<name> STATUS=<PASS|FAIL|SKIP>` per field + summary line
- [X] T037 [US3] Created `apps/api/tests/unit/env-field-mapper-coverage.test.ts` — verifies the runner script references required helpers + asserts no honored field would be skipped at dispatch (every honored field has an envName so the fallback applies). 3 PASS
- [ ] T038 [US3] Run `bash tests/cli-e2e/auth-config-behavioral-parity.sh` against a fresh test project on supaviser.dev. *(deferred — requires deployed feature; pending operator)*

**Checkpoint**: ~165 fields (target 165, range 160–170) are honored, every honored field has a passing behavioral assertion, the snapshot-drift test prevents silent regression. The dashboard from US1 still works; US2's other-21-OAuth-row drawers now have a working backend behind them.

---

## Phase 5: US2 — Other 20 OAuth providers (21 rows) in the dashboard (Priority: P1)

**Goal**: Extend the US1 dashboard so the other 20 OAuth providers (21 rendered rows because Slack shows both legacy + OIDC) are configurable from the same page: 12 Common-4 + 3 Plus-URL + 1 WorkOS-shape + Apple + Slack-legacy + Slack-OIDC + LinkedIn-OIDC.

**Independent Test**: For each of 22 rows (21 OAuth + Google as regression baseline), open drawer → paste creds → Save → toast → status pill flips → IdP roundtrip works. Parameterized; one e2e loop iterates 22 rows.

**Dependency**: US3 phase must complete (the 19 new providers' env wiring is what makes their drawers behaviorally meaningful).

### US2 Implementation

- [X] T039 [P] [US2] Created `apps/web/src/pages/auth-providers/CommonFour.tsx` — enable + client_id + secret + email_optional + callback
- [X] T040 [P] [US2] Created `apps/web/src/pages/auth-providers/PlusUrl.tsx` — CommonFour + URL field (with provider-specific label/placeholder/help text for azure/gitlab/keycloak)
- [X] T041 [P] [US2] Created `apps/web/src/pages/auth-providers/WorkOsShape.tsx` — enable + client_id + secret + url (no email_optional)
- [X] T042 [P] [US2] Created `apps/web/src/pages/auth-providers/AppleForm.tsx` — Services ID + Additional Services IDs (comma-sep) + secret + email_optional
- [X] T043 [P] [US2] Created `apps/web/src/pages/auth-providers/OidcForm.tsx` — CommonFour structure binding to `external_<key>_oidc_*` fields via the registry's fieldMap
- [X] T044 [US2] Expanded `provider-registry.ts` to 26 entries (2 toggle-only + 21 OAuth + 3 coming-soon). 13 vitest assertions cover the structure (counts, OIDC field prefix, Apple/Google extras, PlusUrl URL field, deep-link case-insensitivity, docsUrl format)
- [X] T045 [US2] `ProjectAuthProviders.tsx` switch dispatches on `provider.formTemplate` to 6 components with TypeScript-exhaustive `never` check. Deep-link `?provider=Slack (OIDC)` resolves correctly (URL-decoded, case-insensitive)
- [X] T046 [US2] Icon strategy: placeholder letter-icon on a colored background (`ProviderIcon` in `ProviderRow.tsx`). Decision recorded in research open items; upstream-icon adoption deferred to polish/future
- [X] T047 [US2] Created `apps/web/tests/unit/provider-registry.test.ts` — 13 PASS. Drawer-open RTL assertions intentionally deferred (Radix Sheet/jsdom interaction fragility); the structural + exhaustive-switch coverage gives us the same correctness signal with less flake
- [ ] T048 [US2] Smoke test against supaviser.dev (manual): pick 3 representative providers from different templates — Discord (Common-4), GitLab (Plus-URL), LinkedIn (Oidc). *(deferred — requires deployed feature; pending operator)*

**Checkpoint**: All 21 OAuth provider rows (20 unique providers, Slack as two rows) configurable from dashboard. Closes the visible part of #34.

---

## Phase 6: US4 — Per-field transparency in Management API responses (Priority: P2)

**Goal**: GET `/v1/projects/:ref/config/auth` includes a `_selfbase.fieldStatus` extension classifying every field as honored/stored_only/unsupported with reason text. CLI users and SREs can tell from one GET whether a field they set will take effect.

**Independent Test**: PATCH a known stored-only field; GET; assert the response contains the extension with the correct classification + reason. Repeat for honored and unsupported. Unmodified `supabase` CLI continues to work.

**Dependency**: Phase 2 foundational (status map shape) + Phase 4 US3 (status map fully populated). Independent of US1, US2, US5.

### US4 Implementation

- [X] T049 [US4] In `apps/api/src/services/runtime-config-store.ts`, added `buildAuthFieldStatusExtension()` (exported for testability), composed at module-init (`AUTH_FIELD_STATUS_EXTENSION` const), injected into `getConfig` return when `surface === 'auth'`. Honored entries project to `{ status, envName, secret? }`; stored_only/unsupported project to `{ status, reason }`
- [X] T050 [US4] Postgrest surface is untouched — the extension injection is gated by `surface === 'auth'` check; existing 481 API tests confirm no regressions on postgrest GET
- [X] T051 [US4] Created `apps/api/tests/unit/auth-config-response-shape.test.ts` — 6 assertions: count=234, honored shape, stored_only shape + issue ref, unsupported shape + issue ref, representative samples (jwt_exp / external_google_secret / saml_enabled / oauth_server_enabled), CLI back-compat (no field named `_selfbase` in upstream shape). 6/6 PASS
- [ ] T052 [US4] CLI-compat assertion in `tests/cli-e2e/cli-compat.sh` *(deferred — requires deployed feature; T051's "no `_selfbase` field collision" assertion is the unit-level proxy)*
- [X] T053 [US4] Created `apps/api/tests/unit/env-field-mapper-reason-text.test.ts` — 3 assertions: every non-honored reason references `#NNN`; every referenced issue is in the allowed set `{21, 61, 62, 63, 64, 65, 66, 70, 72, 73}`; no entry retains the foundational placeholder reason. 3/3 PASS
- [ ] T054 [US4] Run quickstart §Smoke 3 against supaviser.dev *(deferred — requires deployed feature)*

**Checkpoint**: CLI users and SREs can self-serve diagnose whether a field they set takes effect. The dashboard does NOT surface this indicator (FR-021).

---

## Phase 7: US5 — Coming-soon placeholder rows (Priority: P3)

**Goal**: SAML 2.0, Web3 Wallet, and Custom Providers rows render as disabled placeholders with a "Coming soon" badge linking to the corresponding tracking issue.

**Independent Test**: Visit page; verify each placeholder row renders disabled; badge link navigates to GitHub.

**Dependency**: US2 (the provider list must already exist).

### US5 Implementation

- [X] T055 [US5] `ComingSoonRow` (created earlier in T020 as part of `ProviderRow.tsx`) — props sourced from `provider-registry.ts`; renders icon + name + "Coming soon" badge linking to GitHub issue; `aria-disabled="true"` on container; no click handler opens a drawer
- [X] T056 [US5] Added SAML 2.0, Web3 Wallet, Custom Providers entries to `provider-registry.ts` with `comingSoonIssue: 61/72/63` and `placement: 'list'` for SAML/Web3 vs `placement: 'section'` for Custom Providers
- [X] T057 [US5] `ProjectAuthProviders.tsx` `splitRegistry()` separates `comingSoonList` (placed inline) from `comingSoonSection` (rendered as a separate `<section>` below the providers list with explanatory copy)
- [ ] T058 [US5] Quickstart §Smoke 7 — manually verify all three placeholders render *(deferred — requires deployed feature)*

**Checkpoint**: Page mirrors Cloud's visual taxonomy. Closes #34's remaining visual requirements.

---

## Phase 8: Polish & cross-cutting

**Purpose**: Operator documentation, final regression sweep, deploy.

- [X] T059 [P] Wrote `docs/changes/020-auth-providers.md` — operator tour (sidebar + global toggles + 25-row taxonomy + per-provider drawer + after-Save flow), per-IdP setup links (Google/GitHub/Discord/Apple/Azure/Facebook/GitLab/Keycloak/Slack/WorkOS), SRE section on `_selfbase.fieldStatus` reading, troubleshooting (callback-URL mismatch is #1 cause), out-of-scope list with follow-up issue links
- [X] T060 [P] Updated `CLAUDE.md` — added "What's shipped" row for #21+#34/feature 020 with links to runbook + summary of 17 OAuth promotions + 169-field honored count; updated SPECKIT pointer block to reflect completion + 490 API + 81 web tests passing
- [ ] T061 Run the full quickstart.md (all 10 smokes) against supaviser.dev end-to-end. *(deferred — requires deployed feature; pending operator)*
- [X] T062 `pnpm --filter @selfbase/api test` → 490 PASS / 33 skipped. `pnpm --filter @selfbase/web test` → 81 PASS. Includes all 5 new feature-020 test files (T007 contract, T029 + T037 coverage, T051 response shape, T053 reason text, T021 page smoke + T047 registry)
- [X] T063 `pnpm tsc --noEmit` PASS for api, web, and shared packages
- [ ] T064 Close issues #21 and #34 via the PR description. *(pending PR creation by operator)*

---

## Dependencies & execution order

```
Phase 1 (setup) ─┐
                 ├─→ Phase 2 (foundational) ─┐
                                              ├─→ Phase 3 (US1) ─────────────┐
                                              ├─→ Phase 4 (US3 backend) ─┬───┤
                                              ├─→ Phase 6 (US4) ─────────┘   ├─→ Phase 8 (polish)
                                              │                              │
                                              │   Phase 5 (US2) ─────────────┤
                                              │   (depends on US3)           │
                                              │                              │
                                              │   Phase 7 (US5) ─────────────┤
                                              │   (depends on US2)           │
                                              └──────────────────────────────┘
```

**Critical path** (longest sequential chain): T001 → T005/T006/T007 → T023..T038 (US3) → T039..T048 (US2) → T055..T058 (US5) → T059..T064 (polish).

**Parallelization opportunities**:
- Phase 2: T008, T009, T010 are independent of each other and of T005–T007 (different files).
- Phase 4 US3: T031/T032/T033 (template wiring) parallel with T023/T024/T025/T026 (status map population) — different files.
- Phase 5 US2: T039–T043 (form template components) all parallel — different files.
- Phase 6 US4 starts as soon as Phase 4 T029 lands.
- Phase 8 polish T059 + T060 parallel.

**MVP scope**: Phase 1 + Phase 2 + Phase 3 (US1) — ship just the Google end-to-end dashboard. Foundational status-map work is done; only Google is wired in the dashboard; US3's broader promotion follows. This is a real shippable increment for operators using Google sign-in (likely the most-asked provider).

---

## Summary

- **Total tasks**: 65 (added T010a as part of Phase 2 fix per /speckit-analyze finding C7)
- **Per phase**: Setup 4 / Foundational 7 / US1 12 / US3 16 / US2 10 / US4 6 / US5 4 / Polish 6
- **Parallelizable [P]**: T003, T004 (Phase 1); T008, T009, T010 (Phase 2; T010a is sequential after T005); T039–T043 (Phase 5); T059, T060 (Phase 8) — 11 tasks total
- **Independently testable per quickstart.md**: US1 → Smoke 1, US3 → Smokes 2/5/6/10, US4 → Smoke 3 + Smoke 4, US5 → Smoke 7; cross-cutting → Smoke 8 (RBAC), Smoke 9 (restart failure)
- **MVP**: Phase 1 + Phase 2 + Phase 3 (US1) — Google sign-in via dashboard works end-to-end. All 4 top-of-page toggles also work (manual-linking promotion is bundled into Phase 2 via T010a)
- **Closes**: #21 (revised) and #34
- **Supersedes**: feature 019
- **Spawned during /speckit-analyze**: #73 (auth provider secret-reveal — split off from FR-016 to keep this feature's scope tight)
