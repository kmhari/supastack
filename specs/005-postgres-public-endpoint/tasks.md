# Tasks: Postgres Public Endpoint via SNI Routing

**Input**: Design documents from `specs/005-postgres-public-endpoint/`

**Feature**: Caddy L4 SNI routing on `:5432` → per-instance Postgres + `POSTGRES_HOST` fix for Studio

**Prerequisite**: Feature 004 (wildcard cert) — complete

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency conflicts)
- **[US1]**: supabase CLI database commands work at `db.<ref>.<apex>:5432` without `--db-url`
- **[US2]**: Studio "Direct connection" panel shows the correct hostname

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Custom Caddy build with caddy-l4, docker-compose changes. Unblocks both user stories.

- [ ] T001 Create `apps/caddy/Dockerfile` — two-stage Dockerfile: `FROM caddy:2.8-builder AS builder` running `RUN xcaddy build --with github.com/mholt/caddy-l4`, then `FROM caddy:2.8-alpine` with `COPY --from=builder /usr/bin/caddy /usr/bin/caddy`. Add a comment noting this is the first selfbase feature requiring a custom Caddy build (feature 004 used stock Caddy via `load_files`).

- [ ] T002 [P] Edit `infra/docker-compose.yml` — change the `caddy` service from `image: caddy:2.8-alpine` to `build: { context: .., dockerfile: apps/caddy/Dockerfile }`; add `'5432:5432'` to the `caddy.ports` list (alongside existing `'80:80'` and `'443:443'`). Verify no port collision (5432 is not currently used by any other service in the compose file).

- [ ] T003 Verify caddy-l4 module names by running `docker compose -f infra/docker-compose.yml build caddy` followed by `docker compose -f infra/docker-compose.yml run --rm caddy caddy list-modules | grep -E 'layer4|l4'`. Confirm the exact handler/matcher names installed (e.g. `layer4.handlers.postgres`, `layer4.matchers.postgres`, `layer4.handlers.tls`, `layer4.handlers.proxy`, `layer4.handlers.subroute`, `layer4.matchers.tls`). These names are referenced in T004. If they differ from the names in `contracts/caddy-config.md`, update the contract and T004 accordingly before proceeding.

**Checkpoint**: Custom Caddy image builds; `caddy list-modules` reports `layer4.*` entries; port 5432 is published from the caddy container.

---

## Phase 2: Foundational

**No foundational tasks.** This feature introduces no new DB tables, no shared services, and no new API routes. The existing `supabase_instances.portPostgres` column and the wildcard cert (feature 004) are the only dependencies, both already in place.

---

## Phase 3: User Story 1 — supabase db push Works Without --db-url (Priority: P1) 🎯 MVP

**Goal**: Caddy routes `db.<ref>.<apex>:5432` connections by TLS SNI to the matching per-instance Postgres port. `supabase db push/pull/diff/migration/inspect` work without `--db-url`. Documented and verified by a dedicated E2E script.

**Independent Test**:
```bash
SELFBASE_APEX=... SELFBASE_PAT=... SELFBASE_PROJECT_REF=... SELFBASE_DB_PASSWORD=... \
  bash tests/cli-e2e/db-push.sh
# → exit 0 with all 7 ✓ steps
```

Plus manual spot checks:
```bash
openssl s_client -connect db.<ref>.<apex>:5432 -starttls postgres 2>&1 | grep CN=
# → CN=*.<apex>

curl -s http://caddy:2019/config/ | jq '.apps.layer4.servers.postgres.routes[0].handle[1].routes | length'
# → number of active instances
```

### Backend — Caddy L4 Config

- [ ] T004 [US1] Edit `apps/api/src/services/caddy-config.ts` — (a) add `portPostgres: schema.supabaseInstances.portPostgres` to the existing `instances` SELECT alongside `portKong` and `portStudio`; (b) build a `layer4App` object only when both `apex` is non-null AND `wildcardCert` is non-null (reuse the existing `wildcardCert` query from feature 004). The layer4 object shape is exactly as in `contracts/caddy-config.md`: one server `postgres` listening on `:5432`, one outer route with `{ postgres: {} }` matcher and `[postgres handler, subroute]` handle chain. The subroute contains one entry per active (non-deleting) instance with matcher `{ tls: { sni: ['db.<ref>.<apex>'] } }` and handle `[tls handler, proxy handler to host.docker.internal:<portPostgres>]`. (c) In the final returned config, add `...(layer4App ? { layer4: layer4App } : {})` to the `apps` object so the key is OMITTED entirely when no cert/apex. Use the exact module names verified in T003.

### Backend — E2E Test Script

- [ ] T005 [P] [US1] Create `tests/cli-e2e/db-push.sh` — bash script following the exact structure in `contracts/db-push-test.md`. `set -euo pipefail`; required env var guards for `SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF`, `SELFBASE_DB_PASSWORD`; `WORK=$(mktemp -d)` + cleanup trap; write `selfbase.toml` profile; supabase login; scaffold throwaway migration `99999999000000_e2e_db_push_test.sql` that creates `_e2e_db_push_test` table; run `supabase db push --project-ref` (no `--db-url`); assert exit 0; run `migration list`, `db diff`, `db pull -f $WORK/schema.sql`, `inspect db` — each asserting exit 0; cleanup step uses `psql` (graceful skip with warning if psql absent) to drop the test table. Final line: `[db-push] PASS` on success or `FAIL: <step>` + exit 1. Make script executable (`chmod +x`). Add header comment matching the format of `deploy-hello.sh`.

### Documentation

- [ ] T006 [P] [US1] Edit `docs/supabase-cli.md` — find and remove any caveat sentences referring to "db push requires --db-url" or "Not yet (P1+)". Replace with positive instructions: state that `supabase db push`, `db pull`, `db diff`, `migration list`, and `inspect db` all work using the profile-based connection at `db.<ref>.<apex>:5432`. Add a one-line note that this requires the wildcard certificate (feature 004) to be active. Cross-reference the new test script: `For full validation, run: bash tests/cli-e2e/db-push.sh`.

**Checkpoint**: `docker compose up -d` brings up custom Caddy. `curl -s http://caddy:2019/config/ | jq '.apps.layer4'` returns the layer4 block with one route per instance. `bash tests/cli-e2e/db-push.sh` exits 0 against a live deployment. Documentation reflects the new behavior.

---

## Phase 4: User Story 2 — Studio Shows Correct Connection String (Priority: P1)

**Goal**: Newly provisioned instances have `POSTGRES_HOST = db.<ref>.<apex>` in their compose env, so Studio's "Direct connection" panel displays the correct externally-reachable hostname with a `[YOUR-PASSWORD]` placeholder.

**Independent Test**: Provision a new project AFTER this phase. Open `https://studio-<ref>.<apex>/` → Settings → Database. Connection string panel shows `postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.<apex>:5432/postgres` — not `127.0.0.1:5432`.

### Backend — Compose Template

- [ ] T007 [US2] Edit `packages/docker-control/src/compose-template.ts` — locate the `POSTGRES_HOST: 'db',` line inside the `values` object in `renderInstanceEnv`. Change to `POSTGRES_HOST: apex ? \`db.${ref}.${apex}\` : 'db',`. Both `apex` and `ref` are already destructured from `inputs` at the top of the function — no new parameters needed. Add a 1-line inline comment: `// db.<ref>.<apex> when apex is set so Studio's Direct Connection panel shows the publicly-reachable hostname (feature 005). Falls back to internal 'db' if no apex.`

### Backend — Tests

- [ ] T008 [P] [US2] Edit `packages/docker-control/tests/compose-template.test.ts` — add a test case asserting that when `inputs.apex = 'selfbase.example.com'` and `inputs.ref = 'abcdefghijklmnopqrst'`, the rendered env contains `POSTGRES_HOST=db.abcdefghijklmnopqrst.selfbase.example.com`. Add a second test asserting that when `apex` is an empty string, `POSTGRES_HOST=db` (fallback). Use the existing test setup pattern from this file.

**Checkpoint**: `pnpm --filter @selfbase/docker-control test` passes. New instances provisioned after this phase show the correct host in Studio. Existing instances continue running until restarted; on next restart they pick up the new env var.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T009 [P] Create `apps/api/src/services/__tests__/caddy-config.test.ts` (if missing) and add three unit tests for `buildCaddyConfig()`: (a) with NO wildcard cert row → assert `.apps.layer4` is undefined; (b) WITH wildcard cert + apex + 2 instances → assert `.apps.layer4.servers.postgres.routes[0].handle[1].routes.length === 2` and each subroute matches `db.<ref>.<apex>` SNI; (c) with wildcard cert but ZERO instances → assert layer4 block exists but the subroute `routes` array is empty `[]`. Use vitest with a mocked `db()` returning the test data.

- [ ] T010 [P] Verify backward compatibility manually — on a deployment without a wildcard cert (e.g. operator skipped feature 004's wizard step 4), confirm: (a) `caddy list-modules` still shows layer4 modules (build is custom but unused); (b) `curl -s http://caddy:2019/config/ | jq '.apps | has("layer4")'` returns `false`; (c) port 5432 is published but receives no successful connections (TCP RST on connect, expected). Document the verification in the PR description.

- [ ] T011 Run the full VM end-to-end verification per `quickstart.md` Scenarios 1–7. Specifically: deploy the custom Caddy image to the VM, confirm `openssl s_client -connect db.<ref>.<apex>:5432 -starttls postgres` shows the wildcard cert, run `bash tests/cli-e2e/db-push.sh` with real env vars, open Studio and confirm the connection string display, and verify old `<vm-ip>:<portPostgres>` URLs still work. Capture the full output and attach to the PR.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: empty — skipped
- **Phase 3 (US1)**: T004 depends on T003 (verified module names); T005 and T006 are independent of T004 and each other
- **Phase 4 (US2)**: independent of Phase 3 (different files)
- **Phase 5 (Polish)**: T009 depends on T004 complete; T010 and T011 depend on full Phases 1–4

### Within Phase 1

- T001 → T002 (compose references the Dockerfile, but in practice T002 can be done in parallel since the Dockerfile filename is fixed) → T003 (requires built image)
- Actually: T001 + T002 in parallel, then T003

### Within Phase 3 (US1)

- T004 (caddy-config) is the only dependency-bearing task — T005 and T006 don't touch caddy-config
- All three can run in parallel after Phase 1 completes

### Within Phase 4 (US2)

- T007 → T008 (test verifies the change in T007)

---

## Parallel Execution Examples

### Phase 1
```
T001: Create apps/caddy/Dockerfile
T002: Edit infra/docker-compose.yml      ← parallel with T001
T003: Verify module names                 ← after both T001 and T002
```

### Phase 3 (after Phase 1 complete)
```
T004: Edit caddy-config.ts
T005: Create db-push.sh                   ← parallel with T004
T006: Update docs/supabase-cli.md         ← parallel with T004 and T005
```

### Phase 4 (parallel with Phase 3)
```
T007: Edit compose-template.ts
T008: Update compose-template tests       ← after T007
```

### Phase 5
```
T009: Add caddy-config unit tests         ← after T004
T010: Manual backward compat check        ← after T001-T008
T011: VM E2E verification                 ← last (depends on everything)
```

---

## Implementation Strategy

### MVP (US1 only — Phases 1 + 3)

1. T001-T003: custom Caddy build + 5432 port published
2. T004: caddy-config.ts emits layer4 block
3. T005: db-push.sh exists and passes
4. T006: docs updated
5. **STOP and VALIDATE**: run db-push.sh against the VM with real env vars

### Full Delivery

6. T007-T008: POSTGRES_HOST fix for Studio
7. T009-T011: unit tests + backward compat + VM E2E

---

## Notes

- caddy-l4 is the only third-party Caddy module added in this feature. Module names must be verified in T003 before referencing them in T004 — names like `"postgres"` vs `"layer4.matchers.postgres"` may differ across caddy-l4 versions.
- The `tls.certificates.load_files` from feature 004 makes the wildcard cert automatically available to caddy-l4's `tls` handler — no separate cert config needed for the layer4 app.
- No new DB tables, no new migrations, no new API routes. Pure Caddy config + compose template change. Total LOC delta is small.
- `tls-ask.ts` is intentionally NOT modified — the wildcard cert already covers `db.<ref>.<apex>` SNI, so admission lookups are bypassed at the TLS layer.
- The `POSTGRES_HOST` change in T007 only affects NEW instances. Existing instances need a Docker restart to pick up the new env var. This is documented as the migration story in the spec.
- For the cleanup step in T005's `db-push.sh`, prefer using `psql` over running another `supabase db push` with a "drop table" migration — `psql` is faster and doesn't pollute the migration history. Graceful skip if psql isn't on PATH.
