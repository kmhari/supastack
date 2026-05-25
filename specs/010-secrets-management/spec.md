# Feature Specification: Secrets management — single-track via supabase_vault

**Feature Branch**: `010-secrets-management`

**Created**: 2026-05-25

**Status**: Draft (revised — single-track architecture)

## Clarifications

### Session 2026-05-25

- Q: What default TTL should the edge runtime use for its in-process vault cache? → A: 5 seconds (worst-case propagation 5s, comfortably inside the 10s SC-002 budget; ~12 refreshes/min/project under load).
- Q: When the operator saves a secret in the dashboard, should the runtime cache be invalidated proactively or only on TTL expiry? → A: Passive — TTL only. No coordination channel between api and per-project functions container; worst-case propagation = TTL window (5s).
- Q: How should existing `project_secrets` rows be migrated to vault? → A: No migration — operators re-enter secrets after the cutover. Existing edge functions lose their env until operators re-save each secret via the dashboard / CLI. Accepted breaking-change cost in exchange for a clean cutover (no double-storage period, no decrypt-master-key worker job).
- Q: When the runtime can't reach vault AND has no cached entry, how should it spawn the worker? → A: Spawn with no user secrets and log the failure (with names only, never values). Function code's own missing-env handling kicks in; transient DB blips don't cause user-visible function downtime.
- Q: How should the per-project vault extension backfill be triggered for existing instances? → A: ~~Auto on api boot + dashboard button~~ → **Revised after planning**: dashboard button only. The deployment will be reset before this feature ships (no pre-existing instances to backfill), so the boot-scan adds no value. Provision hook handles every new instance; the dashboard button covers the rare backup-restore edge case.

**Input**: Bundles into one user-visible feature:

1. **GitHub issue #5** (rescoped) — enable `pgsodium` + `supabase_vault` per-project so SQL contexts (`pg_cron`, triggers, `pg_net` webhooks, `SECURITY DEFINER` functions) can read secrets via `vault.decrypted_secrets`. Required for Cloud parity. Becomes the foundation for everything else in this feature.
2. **Selfbase dashboard UI for edge function secrets** — Studio's `/project/default/functions/secrets` page is broken (docs only, no CRUD). Selfbase has no dashboard surface for secret management today. Operators `curl` or shell into containers. The dashboard needs a real edit page at `/dashboard/project/<ref>/secrets`, and Studio's broken URL needs to redirect there.
3. **Single source of truth in vault** — edge function secrets and SQL-side secrets share one store (`vault.secrets`). No `.env` file + container restart. Edge function runtime reads from vault at request time with a short TTL cache, so dashboard saves propagate within seconds without bouncing the functions container.

## Background

The earlier draft of this spec described two parallel tracks: `.env` + container restart for `Deno.env.get()` reads, and `supabase_vault` for SQL reads. That split is unnecessary and produces a worse operator experience (restarts, two places to look). The Supabase reference `main/index.ts` (the per-project Edge Runtime bootstrap) accepts an `envVars` map when spawning each user worker via `EdgeRuntime.userWorkers.create({ envVars: { ... } })`. That hook lets the runtime pull secrets from vault on-demand and inject them into the Deno worker's `Deno.env` — so a single vault-backed store powers both consumers.

The corrected model has one storage layer and two consumers:

| Layer | Role |
|---|---|
| `vault.secrets` (per-project Postgres, pgsodium-encrypted) | Single source of truth for user-managed secrets |
| Selfbase dashboard (`/dashboard/project/<ref>/secrets`) | Operator-facing CRUD UI; writes call `vault.create_secret` / `vault.update_secret` / `delete from vault.secrets` via the api |
| Studio's bundled Vault UI (Settings → Vault) | Alternative CRUD UI for the same `vault.secrets` rows; works automatically once the extensions are enabled |
| Per-project edge runtime (`main/index.ts`) | Reads vault on each invocation (short TTL cache), passes the resulting map as `envVars` when spawning user workers — so `Deno.env.get('OPENAI_API_KEY')` returns the live vault value |
| SQL callers (cron, triggers, `pg_net`, SECURITY DEFINER funcs) | `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '...'` — vault's standard read path |

No `.env` writes, no functions-container restarts on save. The existing `project_secrets` table + `RESERVED_SECRET_NAMES` machinery in `apps/api/src/services/secret-store.ts` (built in feature 003 US4) becomes the api's *facade* over vault — same endpoint surface, vault-backed storage. Reserved names (platform-injected env like `SUPABASE_URL`, `JWT_SECRET`) continue to be set at container start time via compose/env, not from vault.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Manage edge function secrets from the dashboard, propagation in seconds (Priority: P1)

An operator wants to set `OPENAI_API_KEY` for their project's edge functions. They navigate to **Project → Settings → Secrets** (new sidebar entry). The page shows:

1. **Add or replace secrets** — a form with one or more rows of `Name` + `Value` fields, an "Add another" button, and "Save".
2. **Custom secrets** — a searchable table of secrets they've set, showing `Name`, `Digest (SHA-256)`, `Updated`, and a per-row menu (Replace / Delete).
3. **Default secrets** — a read-only reference table of platform-reserved names (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SB_REGION`, etc.) so operators know what's injected by the platform.

After Save, the dashboard shows a toast: "Saved." Within seconds (no container restart), the operator's edge function reads `Deno.env.get('OPENAI_API_KEY')` and gets the live value — because the runtime fetches from vault per-invocation with a short TTL cache.

**Why this priority**: This is the headline operator capability. Without it the platform fails the basic "I want to add an API key for my function" test. The single-track-via-vault model also eliminates the worst UX problem of the original design (15-second container restart per save).

**Independent Test**: Visit `/dashboard/project/<ref>/secrets` as admin. Save `TEST_SECRET=hello`. Verify it appears in the Custom secrets table within seconds. Invoke an edge function that returns `Deno.env.get('TEST_SECRET')` — must return `"hello"` within at most the TTL window (≤10s) and without any container restart event in `docker logs`.

**Acceptance Scenarios**:

1. **Given** the operator is on the Secrets page with no custom secrets, **When** they add `FOO_API_KEY=abc123` and click Save, **Then** within 2 seconds the Custom secrets table shows `FOO_API_KEY` with its SHA-256 digest and a fresh `Updated` timestamp.
2. **Given** the operator added a secret 5 seconds ago, **When** an edge function reads `Deno.env.get('FOO_API_KEY')`, **Then** within at most one TTL window (≤10s after the save) the function returns the saved value — without any `functions` container restart.
3. **Given** the operator adds multiple rows in one batch (5 secrets), **When** they Save, **Then** all 5 persist in one server round-trip (a single vault transaction); the page does not require a save click per row.
4. **Given** the operator tries to save a reserved name (`SUPABASE_URL`, `JWT_SECRET`, etc.), **When** they Save, **Then** the request is rejected with: "SUPABASE_URL is a reserved secret managed by selfbase. Reserved names cannot be set." The whole batch is rejected atomically.
5. **Given** the operator typed a value with leading/trailing whitespace, newlines, or embedded quotes, **When** they Save and the runtime injects it into a worker, **Then** the value reaches `Deno.env.get(...)` byte-for-byte identical.
6. **Given** the Custom secrets table has 50 entries, **When** the operator types in the search box, **Then** the visible list filters client-side on substring match within 50ms.
7. **Given** a value contains sensitive characters, **When** the operator saves and re-loads the page, **Then** the digest matches what the platform stored; plaintext never reappears in the UI after save.
8. **Given** the operator deletes a secret via the per-row menu, **When** they confirm, **Then** the row vanishes from the table, the row is deleted from `vault.secrets`, and within the TTL window subsequent function invocations no longer see the env var (`Deno.env.get('NAME')` returns `undefined`).
9. **Given** a non-admin team member views the page, **When** they load it, **Then** they either see a read-only view OR are redirected away, matching the existing RBAC pattern.

---

### User Story 2 — SQL callers read vault secrets (closes issue #5) (Priority: P1)

An operator's SQL needs to call an external API from a `pg_cron` job, a trigger, or a `SECURITY DEFINER` function. The blessed pattern is `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'api_key'`. Today this fails — extensions are bundled in the image but not enabled per-project.

After this story ships, every new project gets `pgsodium` + `supabase_vault` enabled at provision time, and existing projects get them enabled via a one-shot backfill. SQL callers can then read vault secrets the standard way. Studio's bundled Vault page (Settings → Vault) also lights up automatically as an alternative CRUD surface over the same rows.

**Why this priority**: Closes issue #5 directly. Equally important to US1 because both consumers share the same storage layer — vault enablement is the prerequisite for both. Pairing US1 + US2 at P1 reflects that they ship together (vault must be enabled before US1's dashboard works at all).

**Independent Test**: On an existing instance: run the backfill. From psql as `supabase_admin`, run `SELECT extname FROM pg_extension WHERE extname IN ('pgsodium', 'supabase_vault')` — both must be present. Then `SELECT vault.create_secret('test-val', 'test_key')` followed by `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'test_key'` — must return `'test-val'`. Open Studio's Vault page — the secret added via SQL must appear in the UI.

**Acceptance Scenarios**:

1. **Given** a freshly provisioned project, **When** the operator runs `SELECT extname FROM pg_extension WHERE extname IN ('pgsodium', 'supabase_vault')`, **Then** both extensions are present.
2. **Given** an existing project provisioned before this feature shipped, **When** the operator runs the backfill action (dashboard button or one-shot script), **Then** both extensions get enabled. Idempotent: re-running is a no-op.
3. **Given** the extensions are enabled, **When** a SQL caller runs `SELECT vault.create_secret('value', 'name')` then `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'name'`, **Then** the second query returns `'value'`.
4. **Given** the extensions are enabled, **When** the operator visits Studio's Vault page, **Then** the page renders and secrets created via SQL or via selfbase's dashboard (US1) appear; secrets created via Studio's UI are readable from SQL and from edge functions (US1).
5. **Given** the backfill runs against an instance that already has the extensions, **When** it executes, **Then** it succeeds quickly with no error and no version downgrade.
6. **Given** the extensions are enabled, **When** the operator deletes their project via the existing lifecycle delete, **Then** the per-project Postgres is dropped normally — nothing in selfbase's control plane references vault state.

---

### User Story 3 — Edge runtime reads vault with TTL cache (Priority: P1, enabling)

The per-project edge runtime's `main/index.ts` is patched so that when it spawns a user worker via `EdgeRuntime.userWorkers.create(...)`, it builds the `envVars` map by reading from `vault.secrets` (decrypted via `vault.decrypted_secrets`) with a short in-process TTL cache. This is the mechanism that makes US1 work without container restarts. Operators don't see this story directly — they observe its result through US1's acceptance scenarios.

**Why this priority**: Mechanism for US1. Without it, US1's dashboard saves wouldn't reach the Deno runtime. Tagged P1 because it ships in lockstep with US1.

**Independent Test**: With vault enabled and a `TEST_KEY=alpha` row in `vault.secrets`, invoke an edge function reading `Deno.env.get('TEST_KEY')` — must return `'alpha'`. Update the vault row to `'beta'`. Within at most one TTL window (≤10s) a fresh invocation must return `'beta'`. `docker logs selfbase-<ref>-functions-1` must show zero restart events across the test.

**Acceptance Scenarios**:

1. **Given** the runtime has been running for an hour, **When** an edge function is invoked and reads `Deno.env.get('SOMETHING')`, **Then** the value matches the current `vault.secrets` row for that name (refreshed within the TTL window).
2. **Given** the same secret name is read 100 times in one second across worker invocations, **When** the runtime serves those reads, **Then** at most one (or a small bounded number) of `SELECT FROM vault.decrypted_secrets` queries hits the DB — the TTL cache absorbs the rest.
3. **Given** a vault read fails transiently (DB unavailable for a second), **When** the runtime tries to spawn a worker, **Then** the runtime returns the last-known cached value if any; if no cache entry exists, the worker spawns with that env var absent and the function gets `undefined` from `Deno.env.get(...)` (same behavior as if the secret were never set). The error is logged with the secret's name only — never the value.
4. **Given** platform-reserved env vars (`SUPABASE_URL`, `JWT_SECRET`, etc. — set at container start, not in vault), **When** the runtime spawns a worker, **Then** those values come from the container's process env and are merged into `envVars` — vault names cannot override reserved platform env (reserved-name guard runs both at write time in US1 and at injection time here, defense in depth).
5. **Given** the runtime is processing a request and the TTL is exceeded, **When** the next invocation reads a secret, **Then** the runtime refreshes from vault before spawning the worker; the request's added latency is bounded (single batched `SELECT * FROM vault.decrypted_secrets`).
6. **Given** the operator deleted a secret via US1, **When** the next invocation runs after the TTL expires, **Then** the runtime no longer injects that env var; `Deno.env.get('NAME')` returns `undefined`.

---

### User Story 4 — Redirect Studio's broken Secrets URL to the selfbase page (Priority: P2)

When an operator clicks the "Secrets" link in Studio's Edge Functions sidebar at `https://studio-<ref>.<apex>/project/default/functions/secrets`, they currently land on a docs-only stub. After this story ships that URL responds with HTTP 302 to `https://<apex>/dashboard/project/<ref>/secrets` (the page built in US1). Discovery via Studio's sidebar transparently hands off to the working selfbase page.

**Why this priority**: Discoverability. Operators following Studio's UI conventions click the Secrets link. Lower than US1 because US1 is the underlying capability; the redirect is just routing.

**Independent Test**: From a browser, navigate to `https://studio-<existing-ref>.<apex>/project/default/functions/secrets`. The final URL after redirects must be `https://<apex>/dashboard/project/<existing-ref>/secrets` and the secrets page loads.

**Acceptance Scenarios**:

1. **Given** an operator is in Studio's sidebar viewing edge functions, **When** they click "Secrets", **Then** the browser is redirected (HTTP 302) to `https://<apex>/dashboard/project/<ref>/secrets`.
2. **Given** the redirect rule, **When** any URL matches `studio-<ref>.<apex>/project/default/functions/secrets[/...]`, **Then** the ref is extracted from the subdomain and substituted into the destination.
3. **Given** an authenticated Studio session redirects, **When** the operator lands on selfbase, **Then** the dashboard session cookie carries over (both Studio and dashboard sit under the same apex's cookie scope) and they don't bounce to `/login`.
4. **Given** other Studio paths (e.g., `/project/default/sql`, `/project/default/functions/<slug>`), **When** the operator navigates, **Then** Studio renders normally — the redirect only matches `/functions/secrets`.

---

### Edge Cases

**Single-track secrets via vault (US1 + US3):**

- **Empty value submitted**: rejected at the form layer — "Value cannot be empty — use Delete to remove a secret instead."
- **Duplicate name in a single batch**: client collapses to one entry (last value wins) before sending.
- **Paste of `KEY=value` lines into the Name field**: form auto-splits at first `=`, fills both Name and Value.
- **Very large value (>64KB PEM)**: allowed; Value field accepts multi-line via a "Paste large value" toggle that switches to a `<textarea>`.
- **Vault write succeeds but TTL cache hasn't refreshed yet on the runtime**: function invocations within the TTL window see the old value. This is the published contract — the dashboard's toast says "Saved — propagation within 10s" to set expectations. Operators wanting instant propagation can use a `?force_refresh` query param on a debug endpoint (out of v1 scope).
- **DB unreachable when a worker spawns**: runtime falls back to last-cached value per FR-014; if no cache entry, worker spawns without that env (function sees `undefined`). Same observable behavior as a missing secret.
- **`pgsodium` server key not initialized on older instances**: backfill calls `SELECT pgsodium.create_root_key()` if missing before enabling vault. Idempotent.
- **A future Postgres-image upgrade ships different pgsodium/vault versions**: extension upgrade happens on next `CREATE EXTENSION IF NOT EXISTS` call; existing vault data is preserved per upstream contract.
- **Per-project Postgres is paused at backfill time**: backfill skips paused projects with a log entry; operator resumes + re-runs.
- **Operator restores a per-project PG backup taken before this feature shipped**: backfill is safe to re-run after restore; vault install is idempotent.

**Studio redirect (US4):**

- **Self-referential redirect loop**: destination is a different subdomain (`<apex>` vs `studio-<ref>.<apex>`) — loops impossible.
- **Operator on selfbase but not logged in**: redirect lands them at `/login` then bounces back to the secrets page after auth (existing dashboard pattern).
- **Future Studio version moves the URL**: redirect rule is path-specific (`/project/default/functions/secrets`). If Studio moves the page, operators see the broken Studio page until we update the rule. Acceptable — Studio upstream is rarely-changing.

## Requirements *(mandatory)*

### Functional Requirements

#### Vault enablement (US2 — foundation)

- **FR-001**: The per-instance provision flow MUST enable `pgsodium` + `supabase_vault` extensions at the end of per-project bootstrap (after the db service is healthy + per-instance migrations run). Specifically: `CREATE EXTENSION IF NOT EXISTS pgsodium; CREATE EXTENSION IF NOT EXISTS supabase_vault;` (pgsodium first).
- **FR-002**: The dashboard MUST expose a per-project "Enable vault" button (visible only when `vault_enabled_at IS NULL` for that instance) that enqueues an idempotent vault-enable worker job. Used for backup-restore recovery or any rare case where the extensions are missing on a running project. No automated boot-time scan — all new instances get vault enabled via the provision hook (FR-001), so the button is the only out-of-band recovery path.
- **FR-003**: After both extensions are enabled, the standard SQL test `SELECT vault.create_secret('test', 'test_key'); SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'test_key';` MUST succeed and return `'test'`.
- **FR-004**: Studio's bundled Vault UI MUST render correctly for any per-project Studio once the extensions are enabled — no selfbase-side modification to Studio.
- **FR-005**: A new project's status MUST NOT become `running` until both extensions are confirmed enabled — extension enablement becomes part of the provision-time success criterion (alongside the existing pg_password_drift probe from feature 008).

#### Dashboard secrets UI (US1)

- **FR-006**: System MUST expose a new dashboard route at `/dashboard/project/<ref>/secrets` rendered inside the existing project shell, with the project sidebar showing a "Secrets" entry that highlights when active.
- **FR-007**: The page MUST render three sections: (a) "Add or replace secrets" form with row-style Name/Value inputs + "Add another" + "Save" + "Paste large value" toggle, (b) "Custom secrets" searchable table with columns Name, Digest (SHA-256), Updated, and a per-row menu (Replace / Delete), (c) "Default secrets" read-only reference table listing platform-reserved names with one-line descriptions.
- **FR-008**: Existing endpoints `POST/GET/DELETE /v1/projects/<ref>/secrets` (feature 003 US4) MUST be rewired server-side to read/write `vault.secrets` instead of writing to `.env` + restarting the functions container. The wire contract (request/response shapes, error codes, RBAC) MUST be preserved so existing CLI/curl callers continue to work unchanged. The legacy `.env` write path and the post-save container restart MUST be removed.
- **FR-009**: The Save action MUST send all rows as a single batch and persist them in a single vault transaction. On success, the page refetches the Custom secrets list and clears the form. On batch validation failure (reserved name, invalid format), the response surfaces the offending name + reason; the whole batch is rejected atomically.
- **FR-010**: The Custom secrets table MUST never display plaintext values — only the SHA-256 digest derived server-side from the vault row.
- **FR-011**: Delete MUST require a confirmation dialog naming the specific secret(s). On confirm, send a single batch `DELETE /v1/projects/<ref>/secrets`. The api removes the corresponding `vault.secrets` rows.
- **FR-012**: The search box MUST filter the Custom secrets table client-side on case-insensitive substring match against the secret name.
- **FR-013**: Access MUST be RBAC-gated via a new action `instance.secrets.write` for editing (admin-only) and the existing `instance.read` for viewing. Non-write users see the page but Save/Delete are hidden or disabled.

#### Edge runtime vault injection (US3)

- **FR-014**: The per-project edge runtime's `main/index.ts` MUST be patched so that when a user worker is spawned via `EdgeRuntime.userWorkers.create(...)`, the `envVars` parameter includes every active `vault.secrets` row for the project (name → decrypted value), merged with platform-reserved env vars (reserved env takes precedence — vault entries cannot override reserved names).
- **FR-015**: The runtime MUST cache the decrypted vault map in-process with a TTL. Default TTL is **5 seconds**; configurable via the `SELFBASE_VAULT_TTL_MS` env var on the functions container. Cache invalidation is passive — the cache is never busted from outside the runtime; the next read after the TTL elapses triggers a refresh. (No Redis pub/sub, no HTTP invalidate endpoint.)
- **FR-016**: When a vault read fails (DB unreachable, query timeout), the runtime MUST fall back to the last cached map if any. If no cache exists, the runtime spawns the worker with no user secrets and logs the failure with the affected names (never values).
- **FR-017**: The patched `main/index.ts` MUST be baked into the per-instance compose template so every new and existing project's `functions` container picks it up on next deploy/restart. (The container restart needed to roll out the patch itself is a one-time platform upgrade, not a per-save operation.)
- **FR-018**: The patched runtime MUST log only secret *names* on cache refresh / fallback / errors — never values. Existing audit-log redaction rules apply.

#### Studio redirect (US4)

- **FR-019**: The platform MUST issue HTTP 302 for any request whose host matches `studio-<ref>.<apex>` and path matches `/project/default/functions/secrets[/...]`, where `<ref>` is the 20-character ref pattern. Target: `https://<apex>/dashboard/project/<ref>/secrets`, same protocol (HTTPS).
- **FR-020**: The redirect MUST preserve query strings and trailing path segments under the matched prefix.
- **FR-021**: The redirect MUST be implemented at the reverse-proxy layer (Caddy) so it fires before Studio sees the request — no Studio modification.
- **FR-022**: Only the exact `/project/default/functions/secrets[/...]` prefix MUST be redirected. All other Studio paths pass through unchanged.

#### Cross-cutting

- **FR-023**: All new dashboard endpoints MUST use the existing `/api/v1/*` mount + session cookie auth; the secret CRUD endpoints exposed under `/v1/*` (Supabase Management API surface) keep their existing contract for CLI/curl callers.
- **FR-024**: All write operations MUST emit audit log entries — `instance.secrets.set`, `instance.secrets.delete`, `instance.vault.enabled`. Severity: normal.
- **FR-025**: The Studio redirect MUST work for every project without per-project config — the rule applies uniformly across all `studio-*.<apex>` hosts.
- **FR-026**: The `RESERVED_SECRET_NAMES` list (currently in `apps/api/src/services/secret-store.ts`) MUST be moved to `packages/shared` so the dashboard, api, and runtime injection (FR-014's "reserved env takes precedence") all use the same source of truth.

### Key Entities

- **Vault secret** (the single source of truth): row in per-project Postgres `vault.secrets` table (pgsodium-encrypted), readable via `vault.decrypted_secrets`. Owned and managed by per-project Postgres; selfbase's api reads/writes it via SQL but stores no copies in the control plane.
- **Reserved secret name** (existing, now in `packages/shared`): the list of names selfbase injects into containers at start (`SUPABASE_URL`, `JWT_SECRET`, etc.) — guarded at write time (rejected by the api) and at injection time (FR-014 reserved-env-wins guard).
- **`project_secrets` table** (deprecated by this feature, no migration): the existing control-plane table that previously stored encrypted values + drove `.env` writes is no longer read or written by the api. Existing rows are NOT migrated to vault — operators re-enter their secrets via the dashboard or CLI after the cutover. The table may be dropped in a follow-up migration after a deprecation window.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can add, view, search, edit, and delete edge function secrets via the dashboard without leaving the browser. (US1)
- **SC-002**: A secret saved via the dashboard is observable in an edge function (`Deno.env.get(...)`) within 10 seconds of the Save click — without any `functions` container restart event in `docker logs` for that project. (US1 + US3)
- **SC-003**: Saving 10 secrets in one batch completes in under 5 seconds end-to-end (form submit → table refresh showing new digests). (US1)
- **SC-004**: For 100% of existing projects, running the backfill enables `pgsodium` + `supabase_vault` and the standard `vault.create_secret` / `decrypted_secrets` test passes immediately after. (US2)
- **SC-005**: For 100% of new projects provisioned after this feature ships, both extensions are enabled by provision-time and the standard vault test passes without extra action. (US2)
- **SC-006**: Studio's bundled Vault UI renders without error for any project on the deployment after backfill, and secrets visible there match those visible in selfbase's dashboard (US1) and to SQL callers — single source of truth. (US2)
- **SC-007**: For 100% of projects, clicking Studio's "Secrets" link in the Edge Functions sidebar lands the operator on the working selfbase secrets page within 1 second. (US4)
- **SC-008**: Zero regressions for the existing wire contract — secrets set via `supabase secrets set` (CLI) or `curl POST /v1/projects/<ref>/secrets` continue to work (same request/response shapes, same error codes, same RBAC). Newly-set secrets appear in the dashboard (US1), Studio's Vault page (US2), and edge function reads (US3). NOTE: secrets that existed in `project_secrets` *before* the cutover are NOT visible after upgrade until the operator re-enters them — this is the documented breaking change in Assumptions. (Cross-cutting)
- **SC-009**: Non-admin users either see a read-only view of the Secrets page or are redirected away — never a 500 or a half-working form. (US1, RBAC)
- **SC-010**: Under steady-state load (100 edge function invocations/sec reading 5 secrets each), the runtime issues at most ~1 `SELECT FROM vault.decrypted_secrets` per TTL window per project — the cache absorbs the rest. (US3)

## Assumptions

- The `pgsodium` + `supabase_vault` extensions in `supabase/postgres:15.8.1.085` work without additional configuration as long as they install in dependency order (pgsodium first). The image bundles libsodium.
- The per-project Postgres `supabase_admin` role (used by the provision worker + reset-pg-password from feature 008) is SUPERUSER and can install extensions. No new role needed.
- `CREATE EXTENSION` is online — backfilling extension enablement on existing instances does not require a container restart; existing client connections are unaffected.
- The Supabase reference `main/index.ts` (https://raw.githubusercontent.com/supabase/supabase/8bb82bb3a5aee631e8e6e6e0c8a5f6e97fb8f898/docker/volumes/functions/main/index.ts) is the canonical bootstrap and `EdgeRuntime.userWorkers.create({ envVars })` is a stable injection point.
- The TTL cache lives in the `functions` container's Node/Deno process, scoped per project (each project has its own container). No cross-container coordination needed.
- The existing wire contract (`POST/GET/DELETE /v1/projects/<ref>/secrets`) is stable; this feature swaps the backend storage without changing the request/response shapes, error codes, or RBAC.
- The existing dashboard's project sidebar accepts an additional nav entry without restructuring. The Settings sidebar pattern from feature 008 is the design reference.
- Studio's Edge Function "Secrets" page being a docs-only stub is a known upstream limitation. The Caddy redirect is the simplest fix.
- Studio's bundled Vault UI uses the same `vault.secrets` storage and therefore stays in sync with selfbase's dashboard automatically — no integration glue between the two surfaces.
- Out of scope: bulk import/export of secrets (e.g., upload a `.env` file). Single-row or paste-multiline only in v1.
- **Breaking change at cutover**: existing edge functions that rely on secrets stored in the deprecated `project_secrets` table lose those env vars on the first deploy of this feature. Operators MUST re-enter every secret via the dashboard (US1) or CLI (`supabase secrets set`) after upgrade. Release notes MUST call this out explicitly with a recommended re-entry checklist. No automated migration is performed.
- Out of scope: rotating selfbase's master key or re-encrypting old `project_secrets` blobs.
- Out of scope: per-secret access policies, scoping a secret to specific functions, or secret versioning beyond what vault provides natively.
- Out of scope: showing real-time "propagation status" in the UI. The dashboard asserts the published 10-second budget; operators rely on that without polling.
