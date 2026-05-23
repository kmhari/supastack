# Tasks: Postgres Public Endpoint via SNI Routing

**Input**: Design documents from `specs/005-postgres-public-endpoint/`

**Feature**: Caddy L4 SNI routing on `:5432` → per-instance Postgres + `POSTGRES_HOST` fix for Studio

**Prerequisite**: Feature 004 (wildcard cert) — complete

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Create `apps/caddy/Dockerfile` — xcaddy build with `github.com/mholt/caddy-l4`
- [X] T002 [P] Edit `infra/docker-compose.yml` — switch caddy to build; add `5432:5432` port
- [⏭] T003 Verify caddy-l4 module names via `caddy list-modules` — **deferred to T011 (VM)**. Used canonical names from upstream caddy-l4 README (`postgres`, `tls`, `proxy`, `subroute`).

## Phase 2: Foundational

No tasks. No new DB tables / shared services.

## Phase 3: User Story 1 — supabase db push Works Without --db-url (P1) 🎯 MVP

- [X] T004 [US1] Edit `apps/api/src/services/caddy-config.ts` — add `portPostgres` to instances query; emit `layer4` app block when wildcard cert + apex are present
- [X] T005 [P] [US1] Create `tests/cli-e2e/db-push.sh` — 7-step E2E script (login → push → list → diff → pull → inspect → cleanup), executable
- [X] T006 [P] [US1] Edit `docs/supabase-cli.md` — remove "--db-url caveat"; add reference to db-push.sh and feature 005

## Phase 4: User Story 2 — Studio Shows Correct Connection String (P1)

- [X] T007 [US2] Edit `packages/docker-control/src/compose-template.ts` — `POSTGRES_HOST: apex ? \`db.${ref}.${apex}\` : 'db'`
- [X] T008 [P] [US2] Add 2 tests to `packages/docker-control/tests/compose-template.test.ts` — verify `db.<ref>.<apex>` when apex set; fallback `db` when apex empty

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T009 [P] Create `apps/api/tests/unit/caddy-config-layer4.test.ts` — 5 vitest tests covering (a) no cert → no layer4; (b) cert + no apex → no layer4; (c) cert + apex + N instances → N subroutes with correct SNI/dial; (d) cert + apex + 0 instances → empty subroute; (e) handler chain order (`postgres` → `subroute`/`tls`/`proxy`). All passing.
- [⏭] T010 [P] Verify backward compat on a no-wildcard deployment — **deferred to VM verification step**
- [⏭] T011 Run `quickstart.md` scenarios 1–7 on a live VM — **deferred (requires VM deployment)**

## Tests Status

| Suite | Result |
|---|---|
| `pnpm --filter @selfbase/api typecheck` | ✓ clean |
| `pnpm --filter @selfbase/api test tests/unit/caddy-config-layer4` | ✓ 5/5 passed |
| `pnpm --filter @selfbase/docker-control test` (new tests only) | ✓ 2/2 new POSTGRES_HOST tests passed |

(Pre-existing `NEXT_PUBLIC_BASE_PATH` test failure in `compose-template.test.ts` is unrelated to feature 005 — confirmed by running tests on `HEAD` before changes.)

## Deferred Tasks Requiring VM Deployment

- **T003**: `docker exec selfbase-caddy-1 caddy list-modules | grep -E 'layer4|l4'` to confirm exact module names match what's in `caddy-config.ts` (currently using canonical names: `postgres`, `tls`, `proxy`, `subroute`)
- **T010**: On a deployment without a wildcard cert, confirm `curl -s http://caddy:2019/config/ | jq '.apps | has("layer4")'` returns `false`
- **T011**: Run `bash tests/cli-e2e/db-push.sh` against the live VM with real `SELFBASE_*` env vars; verify Studio "Direct connection" panel; verify old `--db-url` path still works

## All 9 in-codebase tasks complete ✓ — 3 tasks deferred to VM deployment
