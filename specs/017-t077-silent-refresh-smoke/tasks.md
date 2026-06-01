# Tasks: T077 — Silent OAuth Token Refresh Validation

**Input**: Design documents from `specs/017-t077-silent-refresh-smoke/`

**Prerequisites**: plan.md, spec.md, research.md, quickstart.md

**Only deliverable**: `tests/cli-e2e/t077-silent-refresh.sh` (~120 lines Bash)

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

**Purpose**: Create the script file with header and environment validation.

- [x] T001 Create `tests/cli-e2e/t077-silent-refresh.sh` with shebang, `set -euo pipefail`, usage comment block (mirrors `oauth-dance.sh` header style), and env-var guards for `SUPASTACK_APEX` and `SUPASTACK_SESSION_COOKIE`

---

## Phase 2: Foundational — Token Pair Acquisition (Steps 1–4)

**Purpose**: Copy the OAuth dance setup from `oauth-dance.sh` into the new script. These 4 steps are identical to the existing smoke; they produce the `access_token`, `refresh_token`, and `expires_in` values that the T077-specific logic depends on.

**⚠️ CRITICAL**: Steps 5–10 cannot be implemented until this phase is complete.

- [x] T002 Add Step 1 (DCR register) to `tests/cli-e2e/t077-silent-refresh.sh` — `POST /v1/oauth/register` → `CLIENT_ID`; emit `[T077] STEP: dcr_register | STATUS: <code> | ELAPSED: <s>s`
- [x] T003 Add Step 2 (PKCE + state generation) to `tests/cli-e2e/t077-silent-refresh.sh` — `VERIFIER`, `CHALLENGE`, `STATE` using `openssl` (same as `oauth-dance.sh:37-39`)
- [x] T004 Add Step 3 (authorize consent) to `tests/cli-e2e/t077-silent-refresh.sh` — `POST /v1/oauth/authorize` with `sb_sid` cookie → extract `CODE` from redirect; emit `[T077] STEP: authorize | STATUS: <code> | ELAPSED: <s>s`
- [x] T005 Add Step 4 (token exchange) to `tests/cli-e2e/t077-silent-refresh.sh` — `POST /v1/oauth/token` `authorization_code` grant → capture `ACCESS_TOKEN`, `REFRESH_TOKEN`, `EXPIRES_IN` (validate positive integer); record `ISSUED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)` and `RUN_START=$(date +%s)`; emit step log

**Checkpoint**: Script can acquire a live token pair from `supaviser.dev`. Validate manually by running steps 1-4 and printing the captured values before proceeding.

---

## Phase 3: User Story 1 — Post-Expiry Validation (Steps 5–10) 🎯

**Goal**: Prove SC-003 — after the access token genuinely expires, a refresh token exchange succeeds without browser intervention.

**Independent Test**: `SUPASTACK_APEX=supaviser.dev SUPASTACK_SESSION_COOKIE=<cookie> bash tests/cli-e2e/t077-silent-refresh.sh` runs end-to-end and exits 0 with `[T077] PASS: SC-003 validated`.

### Implementation

- [x] T006 [US1] Add Step 5 (baseline validation) to `tests/cli-e2e/t077-silent-refresh.sh` — `GET /v1/profile` with `ACCESS_TOKEN` → assert HTTP 200; emit step log; on failure: `[T077] FAIL: baseline_profile_call_failed | step: step5_baseline | status: <code> | body: <truncated>` + `exit 1`
- [x] T007 [US1] Add Step 6 (sleep) to `tests/cli-e2e/t077-silent-refresh.sh` — `WAIT_SEC=$((EXPIRES_IN + 60))`; print `[T077] STEP: sleeping | duration: ${WAIT_SEC}s (~$((WAIT_SEC/60))min) | waiting for access token to expire`; `sleep "$WAIT_SEC"`
- [x] T008 [US1] Add Step 7 (negative-path gate) to `tests/cli-e2e/t077-silent-refresh.sh` — `GET /v1/profile` with original `ACCESS_TOKEN` → assert HTTP 401; emit step log; on non-401: `[T077] FAIL: access_token_not_expired | step: step7_expiry_gate | status: <code>` + `exit 1`
- [x] T009 [US1] Add Step 8 (refresh token exchange) to `tests/cli-e2e/t077-silent-refresh.sh` — `POST /v1/oauth/token` `refresh_token` grant → capture `NEW_ACCESS_TOKEN` and `NEW_REFRESH_TOKEN`; assert both non-null and `NEW_REFRESH_TOKEN != REFRESH_TOKEN` (rotation confirmed); emit step log; on failure: `[T077] FAIL: refresh_exchange_failed | step: step8_refresh | status: <code> | body: <truncated>` + `exit 1`
- [x] T010 [US1] Add Step 9 (post-refresh validation) to `tests/cli-e2e/t077-silent-refresh.sh` — `GET /v1/profile` with `NEW_ACCESS_TOKEN` → assert HTTP 200; emit step log; on failure: `[T077] FAIL: post_refresh_profile_failed | step: step9_new_token | status: <code> | body: <truncated>` + `exit 1`
- [x] T011 [US1] Add Step 10 (PASS output) to `tests/cli-e2e/t077-silent-refresh.sh` — record `REFRESHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)` and `TOTAL_ELAPSED=$(($(date +%s) - RUN_START))`; print `[T077] PASS: SC-003 validated | total_elapsed: ${TOTAL_ELAPSED}s | issued_at: $ISSUED_AT | refreshed_at: $REFRESHED_AT`; `exit 0`

**Checkpoint**: Full script runs end-to-end on `supaviser.dev`. Total elapsed ~62 min. Final line is `[T077] PASS`.

---

## Phase 4: Polish

- [x] T012 Make `tests/cli-e2e/t077-silent-refresh.sh` executable: `chmod +x tests/cli-e2e/t077-silent-refresh.sh`
- [x] T013 Verify script passes `shellcheck tests/cli-e2e/t077-silent-refresh.sh` with no errors (same standard as other cli-e2e scripts)
- [x] T014 Run the full script against `supaviser.dev` per `quickstart.md`; capture the `[T077] PASS` output line with `issued_at` and `refreshed_at` timestamps; post it as a comment on issue #54 and tick the T077 acceptance checkbox

---

## Dependencies & Execution Order

- **Phase 1 (T001)**: No dependencies — start immediately
- **Phase 2 (T002–T005)**: Depends on T001; tasks are sequential (each step builds on the previous variable state in the script)
- **Phase 3 (T006–T011)**: Depends on Phase 2 complete; tasks are sequential within the script
- **Phase 4 (T012–T014)**: T012–T013 after T011; T014 requires the live deployment (real ~62 min run)

---

## Implementation Strategy

Single developer, sequential:

1. T001–T005 (30 min): Script skeleton + token acquisition — validate manually against `supaviser.dev` to confirm steps 1–4 work before committing to the 62-min wait.
2. T006–T011 (30 min): Post-expiry logic — can be written and reviewed offline before running live.
3. T012–T013 (5 min): Chmod + shellcheck.
4. T014 (62 min wall-clock): Live run — kick off, walk away, come back with the PASS line to close #54.

---

## Notes

- No parallelism available — all tasks write to the same single-file script
- T014 is wall-clock blocked (62 min); schedule it at end of a working session
- Failure messages include `step:` prefix so triage distinguishes environmental failures (T002–T006) from contract regressions (T008–T010)
