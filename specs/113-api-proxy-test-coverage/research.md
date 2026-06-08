# Research: Comprehensive API & Proxy Test Coverage

## Decision 1: Fake upstream implementation

**Decision**: Node.js built-in `http.createServer` bound to port 0 (OS-assigned random port).

**Rationale**: Zero new dependencies. Already in `node:http` which is available in Node 20. Binding to port 0 avoids port collisions in CI. The server stores the last received request in a shared variable that tests can inspect after the inject call. The `TEST_KONG_BASE_URL` seam already exists in `platform-proxy-helpers.ts` — this approach exercises the full `proxyToKong` code path including header forwarding and body serialization.

**Alternatives considered**:
- MSW (Mock Service Worker): more features, but adds a dependency and is designed for browser mocking — overkill for a simple "what path did I receive?" assertion.
- `nock`: Node.js HTTP interceptor. No port needed, but intercepts at the `http.request` level, not at the URL level. Doesn't work well with `undici` (which uses its own connection pool). Would have required `nock` as a new dependency anyway.

## Decision 2: gen-types test mock strategy

**Decision**: Mock `gen-types-service.js` (the `generateTypes` export) rather than `proxyToKong` or `callPerInstanceMeta`.

**Rationale**: The route delegates all pg-meta interaction to `gen-types-service.ts`. The service has its own error class (`GenTypesError`) with discrete codes (`schema_not_found`, `instance_not_running`, `meta_upstream_error`, `meta_unreachable`). Mocking the service tests the route's error-mapping logic cleanly. The service itself is covered separately by the fake-upstream tests.

**Alternatives considered**: Mocking `proxyToKong` — would also work but requires setting up the full `InstanceRow` shape and bypasses the service's error normalization.

## Decision 3: postgrest-config DB mock

**Decision**: Mock `@supastack/db` to return `vi.fn()` for `db()` that supports `.select().from().where().limit()` chaining returning an empty array, and mock `@supastack/crypto` to return `decryptJson` as `vi.fn(() => ({}))`.

**Rationale**: The `GET /projects/:ref/postgrest` handler directly calls `db()` to fetch `encryptedSecrets` for the jwt_secret injection. There is no service-layer abstraction here (unlike pgbouncer-config). Mocking the drizzle chain is the minimal approach — the chain shape is `.select().from().where().limit()` which can be stubbed with a fluent mock returning `[]`.

**Alternatives considered**: Extract the db call into a helper function — cleaner but adds scope creep (production code change for test convenience, which contradicts the zero-source-change constraint for this feature).

## Decision 4: migrations error class mocking

**Decision**: Re-declare the error classes in the mock using `vi.hoisted` (same pattern as `ProxyProjectNotFoundError` in `platform-proxy.test.ts`) rather than importing and re-using them.

**Rationale**: The route catches `InstanceNotFoundError`, `InstanceNotRunningError`, `PerInstancePgConnectError` from `per-instance-pg.js`. If we mock `per-instance-pg.js`, the mock's classes and the route's imported classes are the same module instances (because Vitest resolves mocks before imports), so `instanceof` checks work correctly.

## Decision 5: VM smoke test HTTP client

**Decision**: Node.js 20 built-in `fetch`. No new dependency.

**Rationale**: Node 20 ships `fetch` as a stable global. The integration tests already use `pg` (Node.js native binding) — staying with built-ins keeps the test footprint minimal.

## Decision 7: platform-misc db() mock strategy

**Decision**: Mock `@supastack/db` with a configurable fluent chain (same pattern as `platform-organizations.test.ts`). A `let selectResult: unknown[] = []` variable is set per-test to control what `select().from().where().limit()` returns. `drizzle-orm` operators (`and`, `eq`, `desc`, `isNull`) are mocked as identity functions.

**Rationale**: The `platform-organizations.test.ts` already establishes this pattern — reuse it verbatim across all three US4 test files. The drizzle chain is always `select → from → where → limit` for reads and `update → set → where` for writes; these can be fully mocked with a shallow object.

**Alternatives considered**: Using `drizzle-orm/pg-core` test utilities — these don't exist in a useful form for unit tests without a real DB. Using `vi.spyOn(db(), 'select')` — the `db()` function returns a new object each call, making spyOn fragile. The module-level mock is more reliable.

## Decision 8: auth hooks config test strategy

**Decision**: Register both `platformMiscRoutes` AND `authConfigRoutes` in the same test Fastify app, with `project-store.js` + `runtime-config-store.js` mocked (same as `realtime-config.test.ts`).

**Rationale**: `GET/PATCH /platform/auth/:ref/config/hooks` uses `app.inject()` internally to call `/v1/projects/:ref/config/auth` on the same Fastify instance. If `/v1/projects/:ref/config/auth` is not registered, `app.inject()` returns 404 and the hook routes return 404 for every request regardless of project state. Registering both route sets in the test app makes the delegation chain testable end-to-end without any additional mocking complexity — all we need are the same store mocks already used in realtime/pgbouncer tests.

**Alternatives considered**: Mocking `app.inject` — this would require intercepting Fastify's internals, which is fragile and couples the test to implementation details.

## Decision 6: analytics path assertion

**Decision**: Assert that the upstream path is `/analytics/v1/api/endpoints/logs.all` (not `/analytics/v1/api/endpoints/endpoints/logs.all`).

**Rationale**: This is the exact doubling bug fixed in feature 112. The route uses prefix `/analytics/v1/api/` + wildcard `endpoints/logs.all` — the prefix must not include `endpoints/` or the path doubles. A fake-upstream test that asserts the exact received path will catch any regression of this fix.
