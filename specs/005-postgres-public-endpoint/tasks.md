# Tasks: Postgres Public Endpoint (Custom Proxy + Top-Level Supavisor)

**Input**: Design documents from `specs/005-postgres-public-endpoint/`

**Feature**: Two endpoints — direct (`db.<ref>.<apex>:5432` via custom STARTTLS+SNI proxy) + pooled (`pooler.<apex>:6543` via top-level Supavisor). Per-instance supavisor removed for new instances.

**Prerequisite**: Feature 004 (wildcard cert) — complete

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no unmet dependencies)
- **[US1]**: `supabase db push` works without `--db-url` (P1, MVP)
- **[US2]**: Studio "Direct Connection" panel shows correct hostname (P1)
- **[US3]**: Operator sees pooler health + per-project metrics (P2)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Port allocator slot + clean up Caddy-L4 leftovers + delete obsolete pg-edge prerequisites.

- [X] T001 Edit `packages/db/src/port-allocator.ts` — add a new port slot `dbDirect` alongside existing kong/studio/postgres/pooler/analytics. Reserve from the same pool. Update the `allocatePorts()` return type and `assignPortsToInstance()` writer to handle the new column. Update the corresponding `supabase_instances` schema if it stores per-instance ports as columns (check `packages/db/src/schema/instances.ts`); if storing as JSON, just update the type.
- [X] T002 [P] Edit `apps/api/src/services/caddy-config.ts` — REMOVE the `layer4` block we added in earlier attempts (`apps: { layer4: { servers: { postgres: {...} } } }` along with the conditional). Update the existing layer4 unit test (`apps/api/tests/unit/caddy-config-layer4.test.ts`) to assert layer4 is NEVER emitted (delete the "with-cert" cases; keep only the "no-cert" case asserting absence).
- [X] T003 Edit `infra/docker-compose.yml` — REMOVE `'5432:5432'` from the `caddy.ports` list. Caddy no longer owns this port. The api container will bind to it via the new proxy.

**Checkpoint**: `pnpm typecheck` passes; Caddy restart drops port 5432 cleanly.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB migrations + Drizzle schema + per-instance compose changes (remove per-instance supavisor; publish per-instance db on the new host port). These are prereqs for both US1 (proxy needs the published port + DB schema) and US3 (supavisor needs the `_supavisor` schema).

- [X] T004 Create `packages/db/migrations/0004_supavisor_schema.sql` — idempotent: `CREATE SCHEMA IF NOT EXISTS _supavisor;` plus a `GRANT ALL ON SCHEMA _supavisor TO selfbase;` (supavisor's Ecto migrations will create the tables on first boot — we just need the schema to exist).
- [X] T005 Create `packages/db/migrations/0005_pooler_tenants.sql` — idempotent: `pooler_tenants` table (id, instance_ref FK, external_id UNIQUE, sni_hostname, pool_size, max_clients, registered_at, last_health_at, status CHECK, last_error, created_at, updated_at) + `pooler_events` table (id, tenant_id FK, external_id, event CHECK, detail jsonb, created_at) + indexes per `data-model.md`.
- [X] T006 [P] Create `packages/db/src/schema/pooler.ts` — Drizzle schema for `poolerTenants` and `poolerEvents` matching the migration. Export both.
- [X] T007 Edit `packages/db/src/schema/index.ts` — add `export * from './pooler.js';`.
- [X] T008 [P] Edit `packages/docker-control/src/compose-template.ts` — (a) ADD `POSTGRES_DIRECT_HOST_PORT: ports.dbDirect` to the rendered env; (b) REMOVE all `POOLER_*` env vars (POOLER_PROXY_PORT_TRANSACTION, POOLER_DEFAULT_POOL_SIZE, POOLER_MAX_CLIENT_CONN, POOLER_TENANT_ID, POOLER_DB_POOL_SIZE, POOLER_POOL_MODE, POOLER_TRANSACTION_HOST_PORT — anything that only existed for per-instance supavisor); (c) update the test in `packages/docker-control/tests/compose-template.test.ts` to assert POSTGRES_DIRECT_HOST_PORT is present and POOLER_* keys are NOT present.
- [X] T009 Edit `infra/supabase-template/docker-compose.yml` — REMOVE the entire `supavisor:` service block. ADD `ports: - "${POSTGRES_DIRECT_HOST_PORT}:5432"` to the `db:` service. Revert the earlier patch comment about `POOLER_TRANSACTION_HOST_PORT` since that var no longer exists.

**Checkpoint**: `pnpm --filter @selfbase/db typecheck` + `pnpm --filter @selfbase/docker-control test` pass. Migration applied to fresh DB without error. Per-instance compose validates with `docker compose config -q` (using sample env).

---

## Phase 3: User Story 1 — supabase db push Works Without --db-url (Priority: P1) 🎯 MVP

**Goal**: Standard Postgres clients (psql, libpq, `supabase` CLI) connect to `db.<ref>.<apex>:5432` with plain `postgres` username and `sslmode=require`. The custom STARTTLS+SNI proxy in the api container handles routing.

**Independent Test**:
```bash
SELFBASE_APEX=... SELFBASE_PAT=... SELFBASE_PROJECT_REF=... SELFBASE_DB_PASSWORD=... \
  bash tests/cli-e2e/db-push.sh
# → exits 0, all 7 steps ✓
```

### Backend — pg-edge proxy service

- [X] T010 [US1] Create `apps/api/src/services/pg-edge-proxy.ts` — implement the STARTTLS+SNI proxy per `contracts/pg-edge-proxy.md`. Exports `startPgEdgeProxy(opts: { port, certPath, keyPath, apexDomain })`. Reads first 8 bytes; matches Postgres SSLRequest magic (`0x00000008 0x04D2162F`); writes `'S'`; wraps socket in `tls.TLSSocket` with `secureContext` from cert files + `SNICallback`; on `secure` event extracts `tlsSocket.servername`; validates regex `^db\.([a-z]{20})\.${apexDomain}$`; calls `lookupBackend(ref)` to get `{host, port}`; opens `net.connect(backend)`; bidirectionally pipes `tlsSocket ↔ backendSocket`; handles close/error propagation on both sides. Include `lookupBackend(ref)` with 60s in-memory cache backed by a `SELECT port_postgres_direct FROM supabase_instances WHERE ref=$1 AND status != 'deleting'` query. Subscribe to Redis pub/sub channels `selfbase:wildcard-cert:reloaded` (re-read cert files, swap `tls.createSecureContext`) and `selfbase:instance:deleted` (invalidate cache for that ref). Export a metrics object that Fastify can expose later.
- [X] T011 [US1] Edit `apps/api/src/server.ts` — after `app.listen({ port, host })`, import `startPgEdgeProxy` and start it on port 5432 reading `apex` from `org.apex_domain` and cert paths from `SELFBASE_CERTS_DIR`. Only start if BOTH (a) apex is set in DB AND (b) cert files exist at the expected path — otherwise log and skip (so dev boots without wildcard cert don't crash). Wire a graceful shutdown handler that closes the proxy listener on SIGTERM.

### Infra wiring

- [X] T012 [US1] Edit `infra/docker-compose.yml` — add `'5432:5432'` to `api.ports` so the api container's pg-edge-proxy is reachable externally. Confirm no conflict (Caddy 5432 was removed in T003).

### Documentation

- [X] T013 [P] [US1] Edit `docs/supabase-cli.md` — update the "Database commands" section (the one we updated in feature 005's earlier pass): keep the positive statement that `db push/pull/diff/migration/inspect` work without `--db-url`, but rewrite the explanation to reference the **direct endpoint via the custom proxy** (not Caddy L4, not supavisor SNI). Add one paragraph explaining the two endpoints (direct on 5432 for standard clients, pooler on 6543 for opt-in pooling).

**Checkpoint (MVP done from user POV)**: deploy + restart api + run `tests/cli-e2e/db-push.sh` → exits 0. New project creation also works end-to-end (the per-instance compose now has db published on a host port, the proxy picks it up via DB lookup).

---

## Phase 4: User Story 2 — Studio Direct Connection Display (Priority: P1)

**Goal**: Studio's "Direct connection" panel shows `db.<ref>.<apex>:5432` instead of internal `db:5432`.

**Independent Test**: Open `https://studio-<ref>.<apex>/` → Settings → Database → "Direct connection" panel shows `postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.<apex>:5432/postgres`.

> NOTE: This requires investigation of the Studio image to find the right env var. If no clean env var exists, the implementation may patch the Studio image or use a build-arg override. The decision in `research.md` Decision 9 deferred this to a follow-up — keeping it scoped here as a small standalone task.

- [ ] T014 [US2] Investigate Studio env vars by inspecting `selfbase-<ref>-studio-1` env on a running VM (`docker inspect`) AND skimming the Supabase Studio source for "Direct connection" rendering. Document the finding in a comment in `packages/docker-control/src/compose-template.ts`.
- [ ] T015 [US2] Based on T014 finding, either: (a) set the appropriate env var in `compose-template.ts` (e.g., `DEFAULT_PROJECT_PG_HOST: \`db.${ref}.${apex}\``), OR (b) if no env var exists, scope creep — punt to a separate issue and mark this US2 as DEFERRED in the spec.

**Checkpoint**: Newly-provisioned project shows correct host in Studio. Existing projects unchanged until restarted.

---

## Phase 5: User Story 3 — Pooler Health Visibility + Pooler Endpoint (Priority: P2)

**Goal**: Top-level Supavisor on `pooler.<apex>:6543` provides connection pooling for opt-in clients. Tenant lifecycle is auto-managed. Dashboard shows pooler health + per-tenant metrics.

**Independent Test**:
```bash
psql "postgresql://postgres.<ref>:<pwd>@pooler.<apex>:6543/postgres?sslmode=require" -c "SELECT 1"
# → 1
```
Dashboard Settings → Database panel shows "Pooler: healthy" with active connection counts.

### Infra — supavisor service

- [X] T016 [US3] Edit `infra/docker-compose.yml` — add a top-level `supavisor:` service per `plan.md` §2. Image `supabase/supavisor:2.7.4`. Ports `'6543:6543'`. Mount `certs-data:/var/selfbase/certs:ro`. Env: `PORT=4000`, `DATABASE_URL=ecto://selfbase:${CONTROL_DB_PASSWORD}@db:5432/selfbase`, `CLUSTER_POSTGRES=true`, `SECRET_KEY_BASE=${SUPAVISOR_SECRET_KEY_BASE}`, `VAULT_ENC_KEY=${SUPAVISOR_VAULT_ENC_KEY}`, `API_JWT_SECRET=${SUPAVISOR_API_JWT_SECRET}`, `METRICS_JWT_SECRET=${SUPAVISOR_API_JWT_SECRET}`, `REGION=local`, `ERL_AFLAGS=-proto_dist inet_tcp`, `GLOBAL_DOWNSTREAM_CERT_PATH=/var/selfbase/certs/${SELFBASE_APEX}/cert.pem`, `GLOBAL_DOWNSTREAM_KEY_PATH=/var/selfbase/certs/${SELFBASE_APEX}/key.pem`. Healthcheck via `wget http://localhost:4000/api/health`. `depends_on: db: healthy`. `extra_hosts: host.docker.internal:host-gateway` (so supavisor can reach per-instance Postgres via host port).
- [X] T017 [P] [US3] Edit `infra/.env.example` — document the three new required env vars: `SUPAVISOR_SECRET_KEY_BASE` (≥64 chars), `SUPAVISOR_VAULT_ENC_KEY` (32 hex), `SUPAVISOR_API_JWT_SECRET` (64 hex). Include `openssl rand` examples. Also document `SELFBASE_APEX` (already in .env but mandatory for supavisor cert path interpolation).
- [X] T018 [US3] Add a one-time bootstrap step that runs supavisor's Ecto migrations: either (a) a separate `supavisor-migrate` one-shot service in docker-compose that runs `bin/supavisor eval "Supavisor.Release.migrate"` and exits, with the main `supavisor` service depending on it; OR (b) a startup probe in the api container that detects "table _supavisor.tenants does not exist" and `docker exec`s the migration command. Pick (a) for cleanliness — it's a 5-line docker-compose addition.

### Backend — supavisor admin HTTP client + tenant lifecycle

- [X] T019 [P] [US3] Create `apps/api/src/services/pooler-client.ts` — thin HTTP client for supavisor admin API per `contracts/tenant-registration.md`. Functions: `registerTenant(input: RegisterTenantInput): Promise<void>`, `unregisterTenant(externalId: string): Promise<void>`, `listTenants(): Promise<Tenant[]>`, `getTenant(externalId): Promise<Tenant|null>`, `updateTenant(externalId, partial): Promise<Tenant>`, `getHealth(): Promise<{status, version}>`. Each mints a short-TTL HS256 JWT (5 min) using `SUPAVISOR_API_JWT_SECRET`. Use `undici.fetch`. Retry transient errors (5xx) up to 3 times with exponential backoff. Treat 404 (on DELETE/GET) and 409 (on POST/PUT for already-registered) as success.
- [X] T020 [US3] Create `apps/api/src/services/pooler-tenants.ts` — high-level lifecycle: `registerTenantForInstance(ref, tx?)` and `unregisterTenantForInstance(ref, tx?)`. Inside `registerTenantForInstance`: load instance → decrypt secrets → INSERT pooler_tenants row with status='registering' → call `poolerClient.registerTenant(...)` → on success UPDATE status='active' + INSERT pooler_events; on failure mark status='failed' + last_error, rethrow so caller can roll back. The `tx` arg lets callers wrap this in their own transaction.
- [X] T021 [US3] Edit `apps/api/src/routes/instances.ts` — POST `/instances` handler: after the existing transaction creates the `supabase_instances` row, call `registerTenantForInstance(ref, tx)` INSIDE the same transaction. On any error, the entire tx rolls back (no half-created project). DELETE handler: call `unregisterTenantForInstance(ref, tx)` inside the existing delete tx.
- [X] T022 [P] [US3] Create `apps/api/scripts/backfill-pooler-tenants.ts` — one-shot script. Iterate all `supabase_instances` rows where `status != 'deleting'`. For each, check if a `pooler_tenants` row already exists; if yes skip with log; else call `registerTenantForInstance(ref)` and log result (`✓ ref` or `✗ ref: <error>`). Idempotent — safe to re-run. Document invocation in the script header comment.
- [X] T023 [P] [US3] Create `apps/api/src/services/pooler-reconciler.ts` — BullMQ daily cron at `0 3 * * *`. Steps: (1) list supavisor tenants via `poolerClient.listTenants()`, (2) list selfbase instances, (3) detect drift per `research.md` Decision 8 (orphan / missing / rotated password / stuck-registering), (4) reconcile by calling appropriate register/unregister, (5) log each action to `pooler_events`. Export `createPoolerReconcilerQueue(redisUrl)` and `createPoolerReconcilerWorker(redisUrl)` matching the cert-check pattern in feature 004.
- [X] T024 [US3] Edit `apps/api/src/server.ts` — in `main()`, after starting the api: import and schedule the pooler-reconciler queue with cron `0 3 * * *`.

### Backend — dashboard health endpoint

- [ ] T025 [P] [US3] Create `apps/api/src/routes/pooler-health.ts` — `GET /api/pooler/health` per `contracts/pooler-health-api.md`. Probe `http://supavisor:4000/api/health`, fetch `/api/tenants` and `/metrics` (Prometheus text), parse metrics into per-tenant breakdown, cross-reference with `pooler_tenants` table for drift detection, return the structured JSON per the contract. Also implement `POST /api/pooler/tenants/:ref/re-register` and `POST /api/pooler/tenants/:ref/pool-size` per the same contract. Register in `server.ts` next to the existing routes (T011's edit becomes also `await app.register(poolerHealthRoutes, { prefix: '/api/v1' })`).
- [ ] T026 [P] [US3] Edit `packages/shared/src/schemas.ts` — add Zod schemas: `PoolerHealthResponse`, `PoolerTenantStatus`, `PoolerWarning`, `RegisterTenantInput` matching the contract shapes.

### Frontend — pooler health panel

- [ ] T027 [P] [US3] Edit `apps/web/src/lib/api.ts` — add `poolerApi` object with `health()`, `reregister(ref)`, `setPoolSize(ref, body)` methods using the existing axios client.
- [ ] T028 [P] [US3] Create `apps/web/src/components/PoolerHealthCard.tsx` — card with status badge (green Healthy / yellow Degraded / red Down), total active connections / total pool capacity progress bar, per-tenant table (ref, active/pool, queue, status, "Re-register" button if status≠active). Polls `/api/pooler/health` every 10s when visible.
- [ ] T029 [US3] Edit `apps/web/src/pages/SettingsOrg.tsx` (or create a new `SettingsDatabase.tsx` route + nav tab) — render `<PoolerHealthCard />` in a "Database Connection Pooler" section. Update the Shell nav to include a "Database" tab if needed.

**Checkpoint**: deploy → backfill → `psql postgres.<ref>@pooler.<apex>:6543` works. Dashboard shows pooler health.

---

## Phase 7: Per-Project TLS Certs for Strict-TLS Compatibility (Option B follow-up)

**Goal**: Issue a per-project ACME cert covering exactly `db.<ref>.<apex>` so strict-TLS clients (rustls, sqlx, `supabase db diff --linked`, Go `pgx` with verify-full, etc.) validate the hostname. Falls back to the wildcard cert when per-project cert isn't yet issued.

**Why needed**: The wildcard `*.<apex>` only matches one label (RFC 6125). `db.<ref>.<apex>` is two labels. `sslmode=require` clients (libpq, supabase CLI) don't verify hostnames so they work today, but strict clients fail.

**Why HTTP-01 (not DNS-01)**: fully automatable — no Cloudflare API needed. LE hits `http://db.<ref>.<apex>/.well-known/acme-challenge/<token>` which Caddy forwards to api. Per-project certs auto-issued on instance create.

### Backend — schema + acme service

- [ ] T034 [P] Create `packages/db/migrations/0006_pg_edge_certs.sql` — table `pg_edge_certs (id, instance_ref FK, hostname UNIQUE, cert_pem text, key_pem bytea encrypted, not_before, not_after, status CHECK('pending','issued','failed','expired'), last_error, last_issued_at, last_attempt_at, created_at, updated_at)`. Indexes on `instance_ref` and `not_after` (for renewal scans).
- [ ] T035 [P] Create `packages/db/src/schema/pg-edge-certs.ts` — Drizzle schema. Export `pgEdgeCerts`. Add to `schema/index.ts`.
- [ ] T036 [US1] Extend `apps/api/src/services/acme.ts` with `issuePerProjectCert(ref, apex)`: open ACME order for `db.<ref>.<apex>`; LE returns HTTP-01 challenge tokens; INSERT rows into a new in-memory `acmeChallengeTokens` map keyed by token; complete challenge; finalize order; download cert; INSERT/UPDATE `pg_edge_certs` row with `cert_pem` + encrypted `key_pem`; publish Redis pub/sub `selfbase:pg-edge-cert:issued` with `{ref, hostname}`. Reuse account key from `wildcard_certs.account_key_pem` (same LE account).

### Backend — HTTP-01 challenge endpoint

- [ ] T037 [P] [US1] Create `apps/api/src/routes/acme-challenge.ts` — `GET /.well-known/acme-challenge/:token`. Looks up token in the in-memory `acmeChallengeTokens` map, returns the matching key auth as `text/plain`. Tokens expire after 5 minutes of inactivity. Register in `server.ts` at root prefix (no `/api/v1`).

### Caddy routing for challenge path

- [ ] T038 [US1] Edit `apps/caddy/Caddyfile` — add a route at the top of the `:80` block: `handle /.well-known/acme-challenge/* { reverse_proxy api:3001 }`. Place BEFORE `handle /api/* ...` so it always wins for the well-known path.
- [ ] T039 [US1] Edit `apps/api/src/services/caddy-config.ts` — runtime config: add `/.well-known/acme-challenge/*` route to `httpRoutes` (the :80 listener). Same precedence rule.

### Proxy — SNICallback for per-project certs

- [ ] T040 [US1] Edit `apps/api/src/services/pg-edge-proxy.ts` — replace the single `tlsContext` with: (a) wildcard context (loaded at startup, reload via existing Redis cert:reloaded subscriber); (b) `perProjectContextCache: Map<string, tls.SecureContext>` populated lazily on SNICallback. Add `selfbase:pg-edge-cert:issued` subscriber that invalidates the cache entry for the issued ref. SNICallback: extract ref from SNI, query `pg_edge_certs` for matching row (with 60s cache), build context from cert_pem + decrypted key_pem; on miss, return wildcard context.

### Instance lifecycle integration

- [ ] T041 [US1] Edit `apps/worker/src/jobs/provision.ts` — after instance reaches `running` (post `docker compose up -d` and healthcheck pass), enqueue a `pg-edge-cert-issue` BullMQ job. Job is non-blocking: instance is usable immediately on wildcard fallback; per-project cert lands within ~30 seconds.
- [ ] T042 [US1] Create `apps/worker/src/jobs/pg-edge-cert-issue.ts` — BullMQ worker that calls `issuePerProjectCert(ref, apex)`. Retry 3 times with exponential backoff on transient ACME errors. On final failure, set `pg_edge_certs.status='failed'` + log; don't crash the worker.

### Renewal automation

- [ ] T043 [P] [US1] Edit `apps/api/src/services/cert-check.ts` — extend the daily cron to ALSO scan `pg_edge_certs WHERE status='issued' AND not_after < NOW() + INTERVAL '30 days'`; for each, enqueue `pg-edge-cert-issue` to re-issue.

### Tests + docs

- [ ] T044 [P] Create `apps/api/src/services/__tests__/pg-edge-proxy-sni.test.ts` — vitest: (a) SNI with no per-project cert → wildcard context returned, (b) SNI with per-project cert in DB → per-project context returned, (c) cert-reload signal invalidates cache.
- [ ] T045 [P] Edit `docs/supabase-cli.md` — note that `supabase db diff --linked` (and other strict-TLS clients) work after the per-project cert lands (~30s after instance create).

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T030 [P] Create `apps/api/src/services/__tests__/pg-edge-proxy.test.ts` — vitest unit tests per `contracts/pg-edge-proxy.md` test list: (1) valid SSLRequest → handshake → backend pipe, (2) wrong preamble → close, (3) SNI doesn't match regex → close after handshake, (4) ref not in DB → close, (5) backend dial fails → graceful close, (6) cert reload signal swaps context, (7) apex change signal updates regex. Mock `net.createServer`, `tls.TLSSocket`, DB queries. Aim for >80% branch coverage on the proxy module.
- [ ] T031 [P] Create `docs/pooler.md` — operator guide covering: two endpoints (direct vs pooler), when to use which, connection string formats for each, troubleshooting (pooler down, tenant drift), pool size tuning, cert rotation behavior.
- [ ] T032 [P] Create `apps/api/scripts/cleanup-per-instance-supavisor.ts` — one-shot OPT-IN script for operators who want to remove the idle per-instance supavisor container from EXISTING projects. For each instance: `docker compose --project-name selfbase-<ref> rm -sf supavisor`. Prints a summary. Operators run manually; not auto-triggered.
- [ ] T033 Run full VM end-to-end verification per `quickstart.md` scenarios 1-10. Capture output for the PR description.

---

## Dependencies & Execution Order

### Phase Dependencies

| Phase | Depends on | Notes |
|---|---|---|
| Phase 1 (Setup) | none | Start immediately |
| Phase 2 (Foundational) | Phase 1 | Blocks US1 + US3 |
| Phase 3 (US1) | Phase 1, Phase 2 | MVP — fully testable alone |
| Phase 4 (US2) | Phase 2 (compose-template) | Independent of US1 + US3 |
| Phase 5 (US3) | Phase 2 (DB schema), Phase 3 (server.ts edited) | Larger phase — pooler infra + lifecycle + dashboard |
| Phase 6 (Polish) | Phases 3-5 | Tests + docs after impl |

### Within Phase 2 (Foundational)

- T004, T005, T006 [P], T008 [P] can run in parallel — different files
- T007 depends on T006 (uses `pooler.js`)
- T009 depends on T008 (env var renames must align)

### Within Phase 3 (US1)

- T010 → T011 (server.ts imports the proxy module)
- T010 also blocks T013 (docs describe what's there)
- T012 is independent — different file (docker-compose.yml ports list)

### Within Phase 5 (US3)

- T016 → T017 [P] (env vars docs)
- T016, T018 → T019 (HTTP client needs supavisor reachable)
- T019 → T020 → T021 (chain)
- T022 [P] depends on T020 only
- T023 [P] depends on T019 + T020
- T024 depends on T023
- T025 [P] depends on T019 + T020
- T026 [P] is independent
- T027 [P] depends on T025 (matches the route shape)
- T028 [P] depends on T026 + T027 (uses types + api client)
- T029 depends on T028

---

## Parallel Execution Examples

### Phase 2 (Foundational)
```
T004: Migration 0004_supavisor_schema.sql
T005: Migration 0005_pooler_tenants.sql       ← parallel with T004
T006: Drizzle schema pooler.ts                 ← parallel with T004/T005
T008: compose-template.ts edits                ← parallel with T004/T005/T006
```

### Phase 3 (US1) — after T010 lands
```
T011: server.ts edit (start proxy)
T012: docker-compose.yml caddy ports
T013: docs/supabase-cli.md update              ← parallel with T011/T012
```

### Phase 5 (US3) — once supavisor is reachable
```
T022: backfill-pooler-tenants.ts script
T023: pooler-reconciler.ts BullMQ cron
T025: pooler-health.ts route
T026: schemas.ts Zod types
T027: web/api.ts client
                                ← T022-T027 in parallel
T028: PoolerHealthCard.tsx
```

---

## Implementation Strategy

### MVP First (Phases 1–3 only): ships `supabase db push` working

1. **Phase 1**: T001 (port allocator), T002 (drop caddy layer4), T003 (drop caddy :5432)
2. **Phase 2**: T004–T009 (migrations + schema + compose changes)
3. **Phase 3**: T010 (proxy), T011 (server start), T012 (api port), T013 (docs)
4. **STOP & VERIFY**: `bash tests/cli-e2e/db-push.sh` exits 0 on the VM
5. **Ship Phase 1 as a single PR.** US1 done. Per-instance supavisor removed for new instances.

### Phase 2 (US3 — Pooler endpoint): adds opt-in pooling

6. Add supavisor service + migrations bootstrap (T016–T018)
7. Add lifecycle + reconciler + dashboard (T019–T029)
8. Backfill existing instances (T022)
9. Ship as a second PR

### Phase 3 (US2 + Polish): Studio display + tests + docs

10. T014–T015 (Studio fix — may be deferred depending on T014 outcome)
11. T030 (unit tests)
12. T031 (docs)
13. T032 (opt-in cleanup script for legacy per-instance supavisor)
14. T033 (full VM verification)

---

## Notes

- The `pg-edge-proxy` is the **only new code surface we own**. All other tasks are config, schema, and integration glue. Keep the proxy small and well-tested.
- Existing instances keep their per-instance supavisor running idle — no migration is forced (FR-004). Operators may run T032 cleanup script if they want.
- Both endpoints use the same wildcard cert from `/var/selfbase/certs/<apex>/`. Cert renewal (feature 004) → publish Redis pub/sub event → both pg-edge-proxy AND supavisor reload.
- US3 is P2 — Phase 1 PR can ship without it. Operators who want pooling wait one more PR.
- US2 (Studio display) is independent of routing — feel free to bundle with either phase or ship separately. The CLI test (`db-push.sh`) does NOT depend on Studio display.
