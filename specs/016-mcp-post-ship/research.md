# Research: MCP Post-Ship Hardening (Feature 016)

## Decision 1 — statement_timeout bootstrap location (US1)

**Decision**: Add `ALTER DATABASE postgres SET statement_timeout = 8000;` in `provision.ts` via a dedicated `pg.Client` connection, called after `handleVaultEnable` completes and before `status = 'running'`.

**Rationale**: `vault-enable-job.ts` already establishes the exact same connection pattern (`pg.Client` to `host.docker.internal:<portDbDirect>`, `supabase_admin`, decrypted `postgresPassword`). Reusing this pattern keeps provision.ts self-contained and avoids a new queue hop. The ALTER DATABASE SET is idempotent — re-running it does nothing if the value is already 8000.

**Alternatives considered**:
- Inline inside `bootstrapVault`: Rejected — vault bootstrap is vault-specific; mixing concerns.
- A separate BullMQ job: Rejected — provision.ts already blocks on vault enable; adding another async job creates an ordering gap and a potential race with the first `execute_sql` call.
- PG config file: Rejected — would require editing the per-instance postgres.conf template, which is more fragile than a SQL `ALTER DATABASE`.

---

## Decision 2 — MCP tool filter mechanism (US2)

**Decision**: After `createSupabaseMcpServer({platform})` returns the `Server` instance, capture the existing `tools/list` handler via `(server as any)._requestHandlers.get('tools/list')` and immediately replace it with a filter wrapper using `server.setRequestHandler(ListToolsRequestSchema, ...)`.

**Rationale**: `@modelcontextprotocol/sdk` v1.29.0 stores request handlers in `Protocol._requestHandlers` (a `Map<string, fn>`). The `setRequestHandler` public API replaces the entry. Capturing the original before overriding enables chaining without duplicating the tool manifest. The `any` cast is scoped to a one-line internal access; a comment documents the intention. The approach works regardless of upstream tool registration order because `createSupabaseMcpServer` registers tools synchronously during construction.

**Alternative — `features` option to exclude tool groups**: The `createSupabaseMcpServer` `features` option accepts an array of feature group names (account, database, etc). Using `features: ['database', 'debugging', 'development', 'functions', 'storage', 'docs']` (omitting 'account') would hide all account tools. But this would also hide `list_projects`, `get_project`, `pause_project`, `restore_project` which are in-scope. No per-tool granularity exists at the features level. Rejected.

**Alternative — upstream PR (Option A from issue #51)**: Long-term right approach; filed separately. Does not block this pragmatic fix.

**DEFERRED_TOOLS constant**:
```
'create_project', 'get_cost', 'confirm_cost',
'get_security_advisors', 'get_performance_advisors',
'get_storage_config', 'update_storage_config'
```
(Branching tools are already absent because `platform.branching` is deleted in `platform-build.ts`.)

---

## Decision 3 — Kong analytics patch delivery mechanism (US3)

**Decision**: Template-only fix. Uncomment the analytics block in `infra/supabase-template/volumes/api/kong.yml` so new projects get it automatically. The single existing test project is patched manually once on deploy (uncomment kong.yml + `docker restart supastack-<ref>-kong-1`).

**Rationale**: This is a single-operator test machine, not a multi-project production deployment. An automated worker job to iterate all existing projects is unnecessary complexity for a one-project deployment. The manual op is a one-liner documented in `docs/changes/014-mcp-http-oauth.md` (already exists). Template fix is what matters for ongoing correctness.

**Kong analytics block** (lines ~312–319 in `infra/supabase-template/volumes/api/kong.yml`): The exact commented block is stripped of the `  # ` prefix (2 spaces + `# ` = 4 chars) to uncomment.

---

## Decision 4 — OAuth test mock strategy (US4)

**Decision**: Follow the exact pattern of `apps/api/tests/unit/oauth-register.test.ts` — `vi.hoisted` + `vi.mock` for all external dependencies, `Fastify.inject()` for request/response assertions, no live DB or Redis.

**Mocks needed for authorize.test.ts**:
- `@supastack/db`: `db().select().from().where().limit()` → returns user row with email
- `../../src/services/oauth-clients-store.js`: `getClientById`, `validateRedirectUri`
- `../../src/services/oauth-codes-store.js`: `issueCode`
- `@supastack/shared`: `logger` stub
- Session: `req.session` is accessed via Fastify decorator; inject a `decorate('session', ...)` in the test app builder

**Mocks needed for token.test.ts**:
- `../../src/services/oauth-codes-store.js`: `consumeCode`
- `../../src/services/oauth-refresh-store.js`: `issueRefresh`, `rotateRefresh`
- `../../src/services/oauth-pkce.js`: `verifyChallenge`
- `@supastack/oauth`: `signAccessToken`
- `@supastack/crypto`: `loadMasterKey`
- `@supastack/shared`: `logger` stub, `OAuthTokenRequestSchema` (real, from module)
- `process.env.SUPASTACK_APEX`: set in `beforeEach`

**Authorize route session mock pattern**:
```ts
app.decorate('session', { userId: 'test-user-id' });
// or for no-session case:
app.decorate('session', null);
```
Since `req.session` is accessed as `req.session?.userId`, this works cleanly in Fastify inject tests.

---

## Decision 5 — Regression test for statement_timeout (US1 test)

**Decision**: New Vitest unit test `apps/worker/tests/unit/provision-defaults.test.ts` that:
1. Mocks `pg.Client` (via `vi.mock('pg', ...)`)
2. Calls the new `applyProvisionDefaults(client)` function
3. Asserts `client.query` was called with `ALTER DATABASE postgres SET statement_timeout = 8000;`

This is the same pattern as other worker unit tests. Does NOT require a live database.
