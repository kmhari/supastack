# Research: API Test Coverage

## Decisions

### Test file placement for platform-services endpoint

**Decision**: New file `apps/api/tests/unit/platform-services.test.ts` importing from `platform-misc.ts`.

**Rationale**: The services endpoint (`GET /platform/projects/:ref/services`) is implemented in `platform-misc.ts` and tested via `platformMiscRoutes`. The existing `platform-quick-wins.test.ts` uses this same pattern. A new file keeps test scope small and avoids growing `platform-quick-wins.test.ts` beyond its stated purpose.

**Alternatives considered**: Adding to `platform-quick-wins.test.ts` — rejected because that file's name and purpose is the three quick-win conversions; mixing in the services endpoint blurs the signal.

---

### Test file placement for storage bucket CRUD

**Decision**: New file `apps/api/tests/unit/storage-buckets-crud.test.ts`, separate from the existing `storage-buckets.test.ts`.

**Rationale**: `storage-buckets.test.ts` covers only `GET /v1/projects/:ref/storage/buckets` (list). The POST/GET-single/PATCH/DELETE operations are mutations with different proxy mock call sites (`createBucket`, `getBucket`, `updateBucket`, `deleteBucket`, `emptyBucket`). A dedicated file keeps the mock setup clear and targeted.

**Alternatives considered**: Extending `storage-buckets.test.ts` — acceptable, but the existing mock setup (`proxyMock.listBuckets` only) would need expansion; cleaner to introduce a focused companion file.

---

### Mock pattern for services endpoint DB query

**Decision**: Mock `@supastack/db` with a chained `.select().from().innerJoin().where().limit()` returning a configurable row array via `vi.hoisted()`.

**Rationale**: The services endpoint queries `supabaseInstances` joined with `organizationMembers` and calls `.limit(1)`. This is the standard Drizzle chain mock pattern used across `storage-buckets.test.ts` and `platform-quick-wins.test.ts`. No new patterns needed.

**Alternatives considered**: Real DB connection — rejected; tests must run without a VM.

---

### Mock pattern for storage CRUD proxy calls

**Decision**: Extend the `proxyMock` `vi.hoisted()` object to add `createBucket`, `getBucket`, `updateBucket`, `deleteBucket`, `emptyBucket` as `vi.fn()` entries. Each test sets the mock's resolved value or rejection before calling `app.inject`.

**Rationale**: Mirrors the existing `listBuckets: vi.fn()` mock structure in `storage-buckets.test.ts`. `emptyBucket` is called inside DELETE but failures are swallowed (`.catch(() => {})`), so its mock only needs to resolve.

---

### id→name backfill test location

**Decision**: Cover the `id→name` backfill in `storage-buckets-crud.test.ts` as part of the POST happy path — pass a body with `id` but no `name`, assert `createBucket` is called with a body where `name === id`.

**Rationale**: The backfill lives in `storage-buckets-proxy.ts:132` which is called by the route. Since the route passes `req.body` directly to `createBucket`, and the proxy does the backfill internally, the test should assert on the proxy spy's call arguments (i.e., the body passed to `createBucket` should have `name` equal to `id`), or on the response if the proxy mock returns a shaped response. The cleanest approach: mock `createBucket` to echo back the received body, then assert `response.name === 'my-id'`.

**Alternatives considered**: Testing the proxy function directly — also valid, but the spec's framing is route-level behaviour.

---

### requireRunning helper

**Decision**: Mock the DB select for `supabaseInstances.status` to return `'running'` by default in CRUD tests; test the paused case with `'paused'` to cover the 409 path (already covered in list tests, so CRUD sad-path coverage for 409 is optional).

**Rationale**: `requireRunning` in `storage-buckets.ts` queries the DB. The existing list tests already demonstrate the 409 path. CRUD tests focus on 200/40x/500 paths relevant to the mutation operations.
