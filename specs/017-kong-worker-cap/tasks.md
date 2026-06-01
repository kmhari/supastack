---

description: "Task list for feature 017-kong-worker-cap"
---

# Tasks: Cap Kong Worker Processes Per Project

**Input**: Design documents from `specs/017-kong-worker-cap/`

**Prerequisites**: plan.md, spec.md, research.md, quickstart.md

**Tests**: No automated tests are added for this change. Verification is operational (live VM, see `quickstart.md`). Rationale recorded in plan.md and research.md.

**Organization**: Single user story (US1). This is a one-file config change; the phase structure is preserved for consistency with the speckit workflow but is intentionally minimal.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1)
- Include exact file paths in descriptions

## Path Conventions

Supastack repo layout. Only one file under `infra/supabase-template/` is modified.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: None required — no new tooling, packages, or scaffolding for this change.

*(intentionally empty)*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None required — no shared infrastructure or framework needs to land first.

*(intentionally empty)*

---

## Phase 3: User Story 1 - Cap per-project gateway workers (Priority: P1) 🎯 MVP

**Goal**: Each per-project Kong gateway runs with 2 nginx worker processes (cap), regardless of host CPU count, dropping per-project idle RSS from ~1.25 GiB to < 300 MiB.

**Independent Test**: After deploy, `sudo docker top supastack-<ref>-kong-1 | grep -c 'nginx: worker'` returns **2** for every project, and `docker stats --no-stream` shows each kong container at < 300 MiB RSS at idle. REST/Auth/Storage smoke calls through `<ref>.<apex>` return expected status codes (FR-006).

### Implementation tasks

- [X] T001 [US1] Add `KONG_NGINX_WORKER_PROCESSES: "2"` to the `kong.environment` block in `infra/supabase-template/docker-compose.yml` (place it next to the other `KONG_NGINX_*` keys around line 114–115, alphabetical with `KONG_NGINX_PROXY_PROXY_BUFFER_SIZE`).
- [X] T002 [US1] Update `infra/supabase-template/CHANGELOG.md` with a one-line entry referencing feature 017 and the new env var, dated 2026-05-27.
- [X] T003 [US1] Bump the template version pointer if `infra/supabase-template/versions.md` tracks the template snapshot used by the provisioner (check the file; add a row with today's date and the change summary only if the file is the canonical version pointer — otherwise skip). *(Skipped: `versions.md` tracks image-version bumps only; we are not changing the kong image.)*

### Deploy + verify on VM

- [X] T004 [US1] Rsync `infra/supabase-template/docker-compose.yml` to `/opt/supastack/infra/supabase-template/docker-compose.yml` on `ubuntu@148.113.1.164`. *(scp'd 2026-05-27; line 119 confirms `KONG_NGINX_WORKER_PROCESSES: "2"`.)*
- [X] T005 [US1] For each project in `/var/supastack/instances/<ref>/`: edit per-project compose in place to add the env var, then `sudo docker compose -p supastack-<ref> up -d kong`. *(Path is `/var/supastack/instances/`, not `/opt/supastack/instances/` — corrected during rollout. Rolled xbeg → hpeo → uygn sequentially with health-gated verification between each. All went healthy in seconds.)*
- [X] T006 [US1] Run the smoke checks against each rolled project (`/rest/v1/`, `/auth/v1/settings`). *(All returned 401 with bogus apikey, confirming Kong + auth-plugin chain routing correctly. Skipped `/storage/v1/bucket` for the same reason — auth-chain behaviour is what we needed to verify, not authenticated payloads.)*
- [X] T007 [US1] Capture `free -h` and total kong-container RSS sum before and after rollout. *(Before: 14 GiB used, 3.73 GiB total kong. After: 10 GiB used, 0.39 GiB total kong. Saved 3.34 GiB — exceeds SC-002 threshold of 2.5 GiB.)*

**Checkpoint**: All projects on `supaviser.dev` running with 2 kong workers each. SC-001 and SC-002 verified. SC-003 deferred to the 7-day observation window. US1 complete.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [X] T008 [P] Update `CLAUDE.md` "Active feature pointer" to reference feature 017 (or note completion and revert to 016 if 017 ships ahead of 016 close-out — check git state at PR time).
- [X] T009 [P] Add an entry under `docs/changes/` (e.g., `docs/changes/017-kong-worker-cap.md`) summarizing the change for operators: what changed, why, how to roll back, expected memory savings.
- [ ] T010 [US1] After 7 days post-deploy, check the per-project analytics dashboard for any uptick in gateway-originated 5xx vs. the prior 7 days (SC-003). If clean, close issue #1; if a regression appears, follow rollback in quickstart.md and re-open the spec for a higher cap.

---

## Dependencies

- T001 → T002 → T003 (single repo, single file region; sequential to keep diff coherent).
- T001 must merge before T004 (deploy artifact must reflect the merged change).
- T004 → T005 → T006 → T007 (deploy chain, must be sequential per project, can be staggered across projects).
- T008 and T009 are documentation, independent of deploy; can run in parallel ([P]) any time after T001.
- T010 is time-gated (7 days after T007).

## Parallel opportunities

- T008 and T009 in parallel after T001 lands in the worktree.
- Cross-project staggering of T005/T006/T007 is sequential *per project* but can be batched within a maintenance window.

## Implementation strategy

This is the MVP and the entire feature: one env var, one rollout. No incremental delivery path makes sense — there is nothing smaller to ship first.

- **MVP scope**: T001–T007 (the edit + the rollout + immediate verification).
- **Polish**: T008–T010 (docs + 7-day observation).

## Task format validation

All tasks above follow the required format: `- [ ] TID [P?] [US1?] Description with file path`. Verified manually before commit.
