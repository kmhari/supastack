# Quickstart: Platform Proxy Stub Conversions (Feature 111)

## Test Setup

Same mock pattern as `apps/api/tests/unit/platform-stub-conversions.test.ts`.

```typescript
// vi.hoisted() inject mock
const { injectMock, setInjectResult } = vi.hoisted(() => {
  let result = { statusCode: 200, body: '{}' };
  return {
    injectMock: vi.fn().mockImplementation(() => ({
      statusCode: result.statusCode,
      json: () => JSON.parse(result.body),
    })),
    setInjectResult: (statusCode: number, body: object) => {
      result = { statusCode, body: JSON.stringify(body) };
    },
  };
});
vi.mock('fastify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fastify')>();
  return { ...actual, /* inject override in buildApp */ };
});
```

## Scenario 1 — PostgREST config via api/rest path

```
GET /platform/projects/myref/api/rest
Authorization: Bearer <token>
```

Expected: `200` with real PostgREST config from runtime-config-store.

```json
{ "db_schema": "public", "max_rows": 1000, "db_pool": 15, "db_extra_search_path": "public,extensions" }
```

## Scenario 2 — Postgres tuning config read

```
GET /platform/projects/myref/postgres-config
Authorization: Bearer <token>
```

Expected: `200` with real GUC values (effective_cache_size, max_connections, shared_buffers, work_mem, maintenance_work_mem).

## Scenario 3 — Postgres tuning config update

```
PATCH /platform/projects/myref/postgres-config
Authorization: Bearer <token>
Content-Type: application/json
{ "max_connections": 200, "work_mem": "32MB" }
```

Expected: `200` with the updated config object returned by the postgres-config-store.

## Scenario 4 — Delete function secrets

```
DELETE /platform/projects/myref/functions/secrets
Authorization: Bearer <token>
Content-Type: application/json
{ "secrets": ["MY_API_KEY"] }
```

Expected: `200` (or `204` depending on v1 secrets DELETE response).

## Scenario 5 — API key delete (self-hosted)

```
DELETE /v1/projects/myref/api-keys/some-custom-key-id
Authorization: Bearer <token>
```

Expected: `404` with `{ "message": "API key not found", "code": "not_found" }`.

## Scenario 6 — API key patch (self-hosted)

```
PATCH /v1/projects/myref/api-keys/some-custom-key-id
Authorization: Bearer <token>
{ "name": "Updated name" }
```

Expected: `404` with same shape.

## Sad paths (all endpoints)

- No Authorization header → `401`
- Unknown project ref → `404` (propagated from v1 delegation)
