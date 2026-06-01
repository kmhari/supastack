# Tasks: T078 — Master Key Rotation

**Input**: Design documents from `specs/018-t078-master-key-rotation/`

**Deliverables**:
- `scripts/rekey-master.mjs` — EXISTS (written earlier this session)
- `tests/cli-e2e/t078-key-rotation.sh` — NEW
- `docs/changes/018-master-key-rotation.md` — NEW

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Verify `scripts/rekey-master.mjs` exists and is executable on branch `018-t078-master-key-rotation`; run `node --check scripts/rekey-master.mjs` to confirm syntax; make executable with `chmod +x`

---

## Phase 2: Foundational

**Purpose**: Shared infrastructure needed by both user stories.

- [x] T002 Create `tests/cli-e2e/t078-key-rotation.sh` with shebang, `set -euo pipefail`, usage comment block, env-var guards for `SUPASTACK_APEX`, `SUPASTACK_PAT`, `SUPASTACK_TEST_PROJECT_REF`, `SUPASTACK_VM_USER` (default `ubuntu`), and `DATABASE_URL`; add `_step` and `_fail` helper functions matching the `[T078]` log format from `t077-silent-refresh.sh`

---

## Phase 3: User Story 1 — Atomic re-key + api restart verification (Priority: P1) 🎯

**Goal**: Prove the re-key tool rotates all blobs atomically and the platform continues working after key swap.

**Independent Test**: Run steps T003–T009 on the test VM. Final assertion: `GET /v1/projects/:ref/api-keys` returns valid anon and service-role keys with the new master key in effect.

### Implementation

- [x] T003 [US1] Add Step 1 to `tests/cli-e2e/t078-key-rotation.sh` — generate `NEW_KEY=$(openssl rand -hex 32)`; read `OLD_KEY` from VM via `ssh $SUPASTACK_VM_USER@$SUPASTACK_APEX "grep ^MASTER_KEY /opt/supastack/infra/.env | cut -d= -f2"`; emit `[T078] STEP: key_generation | STATUS: ok | ELAPSED: 0s`

- [x] T004 [US1] Add Step 2 (dry-run) to `tests/cli-e2e/t078-key-rotation.sh` — SSH into VM and run `DRY_RUN=1 OLD_MASTER_KEY=$OLD_KEY NEW_MASTER_KEY=$NEW_KEY DATABASE_URL=$DATABASE_URL node /opt/supastack/scripts/rekey-master.mjs`; capture stdout; assert it contains `DRY-RUN complete`; emit step log with row counts extracted from output

- [x] T005 [US1] Add Step 3 (live re-key) to `tests/cli-e2e/t078-key-rotation.sh` — SSH into VM and run live `node /opt/supastack/scripts/rekey-master.mjs` (no DRY_RUN); assert stdout contains `COMMITTED`; capture and emit the full committed line as `[T078] STEP: rekey_committed | STATUS: ok`; on failure: `[T078] FAIL: rekey_failed | step: step3_live_rekey | body: <truncated>` + `exit 1`

- [x] T006 [US1] Add Step 4 (key swap) to `tests/cli-e2e/t078-key-rotation.sh` — SSH into VM: `sed -i "s/^MASTER_KEY=.*/MASTER_KEY=$NEW_KEY/" /opt/supastack/infra/.env`; verify swap: `ssh … grep ^MASTER_KEY infra/.env` must show `$NEW_KEY`; emit step log

- [x] T007 [US1] Add Step 5 (restart api + worker) to `tests/cli-e2e/t078-key-rotation.sh` — SSH into VM: `sudo docker compose -f /opt/supastack/infra/docker-compose.yml restart api worker`; emit step log

- [x] T008 [US1] Add Step 6 (api health check) to `tests/cli-e2e/t078-key-rotation.sh` — poll `GET https://api.$SUPASTACK_APEX/v1/profile` with `Authorization: Bearer $SUPASTACK_PAT` every 5s for up to 60s until HTTP 200; emit `[T078] STEP: api_health | STATUS: 200`; on timeout: `[T078] FAIL: api_did_not_recover | step: step6_health` + `exit 1`

- [x] T009 [US1] Add Step 7 (api-keys check) to `tests/cli-e2e/t078-key-rotation.sh` — `GET https://api.$SUPASTACK_APEX/v1/projects/$SUPASTACK_TEST_PROJECT_REF/api-keys`; assert response contains `anon_key` and `service_role_key` both non-null and non-empty; emit step log; on failure: `[T078] FAIL: api_keys_decrypt_failed | step: step7_api_keys | body: <truncated>` + `exit 1`

**Checkpoint**: US1 independently testable — re-key committed and api decrypting secrets with new key.

---

## Phase 4: User Story 2 — Pause/restore container lifecycle (Priority: P2)

**Goal**: Prove the full container-lifecycle path (worker decrypts secrets → injects as env vars → starts containers) works after rotation.

**Independent Test**: After US1 completes, run steps T010–T013. Final assertion: project reaches `ACTIVE_HEALTHY` and a request through kong returns 200.

### Implementation

- [x] T010 [US2] Add Step 8 (pause project) to `tests/cli-e2e/t078-key-rotation.sh` — `POST https://api.$SUPASTACK_APEX/v1/projects/$SUPASTACK_TEST_PROJECT_REF/pause`; poll `GET /v1/projects/:ref` every 5s until `status == INACTIVE` (max 60s); emit step log; on timeout: `[T078] FAIL: pause_timeout | step: step8_pause` + `exit 1`

- [x] T011 [US2] Add Step 9 (restore project) to `tests/cli-e2e/t078-key-rotation.sh` — `POST https://api.$SUPASTACK_APEX/v1/projects/$SUPASTACK_TEST_PROJECT_REF/restore`; poll `GET /v1/projects/:ref` every 10s until `status == ACTIVE_HEALTHY` (max 300s / 5 min); emit step log with elapsed time; on timeout or error status: `[T078] FAIL: restore_timeout | step: step9_restore | last_status: <status>` + `exit 1`

- [x] T012 [US2] Add Step 10 (kong request) to `tests/cli-e2e/t078-key-rotation.sh` — determine project kong URL from `GET /v1/projects/:ref` (`endpoint` field); `curl -sk $KONG_URL/health` → assert HTTP 200 or 404 (not 502/503 which would indicate containers failed); emit step log

- [x] T013 [US2] Add Step 11 (PASS output) to `tests/cli-e2e/t078-key-rotation.sh` — record `ROTATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)` and `TOTAL_ELAPSED`; print `[T078] PASS: master-key rotation validated | total_elapsed: ${TOTAL_ELAPSED}s | rotated_at: $ROTATED_AT | project: $SUPASTACK_TEST_PROJECT_REF`; `exit 0`

**Checkpoint**: Full rotation + pause/restore lifecycle confirmed end-to-end.

---

## Phase 5: Polish & Documentation

- [x] T014 [P] Make `tests/cli-e2e/t078-key-rotation.sh` executable: `chmod +x tests/cli-e2e/t078-key-rotation.sh`

- [x] T015 [P] Write `docs/changes/018-master-key-rotation.md` — operator runbook covering: (1) when to rotate (key compromise, routine policy); (2) pre-rotation checklist (DB backup, note current key, low-traffic window); (3) step-by-step procedure referencing `scripts/rekey-master.mjs` and `quickstart.md`; (4) rollback procedure (re-run rekey with keys swapped, restart api/worker); (5) post-rotation verification steps; (6) security notes (old key disposal, no logging of key values)

- [x] T016 Run `tests/cli-e2e/t078-key-rotation.sh` against `supaviser.dev` per `quickstart.md`; capture the `[T078] PASS` output line; post it as a comment on issue #54 and tick the T078 acceptance checkbox

---

## Dependencies & Execution Order

- **Phase 1 (T001)**: No dependencies — verify existing file
- **Phase 2 (T002)**: Depends on T001 — creates the script skeleton
- **Phase 3 (T003–T009)**: Sequential — each step builds on previous SSH state; depends on T002
- **Phase 4 (T010–T013)**: Depends on Phase 3 complete (US1 must succeed before pause/restore)
- **Phase 5 (T014–T015)**: T014 and T015 are [P] — can run in parallel after T013; T016 requires all prior tasks complete and a live run on the VM

---

## Parallel Opportunities

- T014 (chmod) and T015 (runbook) can run in parallel — different files, no dependency on each other
- All other tasks are sequential within their phase (same script file or sequential SSH state)

---

## Implementation Strategy

Sequential — one developer:
1. T001 (2 min): Verify re-key script
2. T002–T013 (45 min): Write E2E script, step by step
3. T014–T015 (15 min): chmod + runbook
4. T016 (5 min): Live run + close #54 T078

Total: ~67 minutes, dominated by writing the E2E script and the runbook.

---

## Notes

- Steps 3–7 in the E2E script require SSH access to the VM (`ubuntu@supaviser.dev`). Assume key-based auth.
- The re-key tool runs on the VM (not locally) because it needs direct `DATABASE_URL` access and the production `.env`.
- `SUPASTACK_TEST_PROJECT_REF` must be a project that is currently `ACTIVE_HEALTHY` before the script starts. If not, the pause/restore step will fail at T010.
- T016 leaves the VM running with a new `MASTER_KEY` — the old key is retired. Document this clearly in the issue comment.
