# Quickstart: Platform Stub Conversions (Tier 1–4)

## Test Execution

```bash
# Run only the new unit tests
pnpm --filter @supastack/api exec vitest run tests/unit/platform-stub-conversions.test.ts

# Full api suite (must remain green)
pnpm --filter @supastack/api test
```

## Mock Pattern

All tests use the same base pattern as `platform-services.test.ts`. Key mock shape:

```typescript
// DB mock (control-plane queries)
const h = { dbRows: [] as unknown[], dbReject: null as Error | null };
vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => chain,
    }),
    update: () => ({ set: () => ({ where: vi.fn() }) }),
    insert: () => ({ values: vi.fn() }),
  }),
  schema: { supabaseInstances: { ref:'ref', status:'status', updatedAt:'updatedAt', orgId:'orgId' }, ... },
}));

// withPerInstancePg mock (Tier 4)
const pgMock = vi.hoisted(() => ({ query: vi.fn(), runLints: vi.fn() }));
vi.mock('../../src/services/per-instance-pg.js', () => ({
  withPerInstancePg: (ref: string, fn: (pg: unknown) => Promise<unknown>) => fn(pgMock),
  InstanceNotRunningError: class extends Error { status = 'paused'; },
}));

// app.inject mock (Tier 3b delegation)
// — handled by buildApp: decorate app with a mock inject
```

## Coverage Matrix

| Endpoint | Happy | 401 | 404 | 503/Error |
|----------|-------|-----|-----|-----------|
| GET pause/status | ✓ paused state | ✓ | ✓ | — |
| GET readonly | ✓ paused + running | ✓ | ✓ | — |
| DELETE readonly | ✓ 200 | ✓ | — | — |
| GET upgrade/status | ✓ restoring | ✓ | ✓ | — |
| GET /audit | ✓ events + empty | ✓ | ✓ | — |
| GET /activity | ✓ events + empty | ✓ | — | — |
| GET downloadable-backups | ✓ backups + empty | ✓ | — | — |
| GET network-bans | ✓ delegation | ✓ | — | — |
| DELETE network-bans | ✓ delegation | ✓ | — | — |
| GET network-restrictions | ✓ delegation | ✓ | — | — |
| POST network-restrictions/apply | ✓ delegation | ✓ | — | — |
| GET ssl-enforcement | ✓ delegation | ✓ | — | — |
| PUT ssl-enforcement | ✓ delegation | ✓ | — | — |
| GET functions/secrets | ✓ delegation | ✓ | — | — |
| POST functions/secrets | ✓ delegation | ✓ | — | — |
| GET run-lints | ✓ results + empty | ✓ | — | ✓ (503) |
| GET run-lints/:name | ✓ filtered | ✓ | — | — |

## Scenarios

### Tier 1 — pause/status returns real state

```typescript
// h.dbRows = [{ status: 'paused', updatedAt: new Date('2026-06-07') }]
// GET /v1/projects/REF/pause/status → { initiated_at: '2026-06-07T...', status: 'not_pausing' }

// h.dbRows = [{ status: 'running', updatedAt: new Date() }]
// GET /v1/projects/REF/pause/status → { initiated_at: null, status: 'not_pausing' }
```

### Tier 1 — readonly reflects paused state

```typescript
// h.dbRows = [{ status: 'paused', ... }]
// GET /platform/projects/REF/readonly → { enabled: true }

// h.dbRows = [{ status: 'running', ... }]
// GET /platform/projects/REF/readonly → { enabled: false }
```

### Tier 1 — DELETE readonly delegates to /v1/restore

```typescript
// app.inject called with { method: 'POST', url: '/v1/projects/REF/restore', ... }
// returns 200 + project object
```

### Tier 2 — audit returns real events

```typescript
// h.auditRows = [{ id: 1, action: 'instance.pause', targetId: REF, ... }]
// GET /platform/projects/REF/audit → { result: [...], count: 1 }
```

### Tier 3a — downloadable backups

```typescript
// h.backupRows = [{ seq: 1n, startedAt: new Date(), completedAt: new Date(), sizeBytes: 1024n, status: 'completed' }]
// GET /platform/database/REF/backups/downloadable-backups → { backups: [{ id: 1, status: 'COMPLETED', ... }] }
```

### Tier 3b — ssl-enforcement delegation

```typescript
// inject returns 200 + { currentConfig: { database: true }, appliedSuccessfully: true }
// GET /platform/projects/REF/ssl-enforcement → same response
```

### Tier 4 — lint queries

```typescript
// pgMock.query resolves rows for no_rls check
// GET /platform/projects/REF/run-lints → [{ name: 'no_rls', level: 'WARN', ... }]

// withPerInstancePg throws InstanceNotRunningError
// GET /platform/projects/REF/run-lints → 503 { error: 'Project is not running', code: 'project_not_running' }
```

## Lint SQL Reference

```sql
-- no_rls: tables without row level security (public schema, not system tables)
SELECT schemaname, tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false
  AND tablename NOT LIKE 'pg_%';

-- duplicate_index: indexes covering identical columns
SELECT indexname, tablename, indexdef FROM pg_indexes
WHERE schemaname = 'public'
GROUP BY tablename, indexdef HAVING count(*) > 1;

-- unused_index: non-primary indexes never scanned (table not empty)
SELECT s.indexrelname AS indexname, s.relname AS tablename, s.idx_scan
FROM pg_stat_user_indexes s
JOIN pg_stat_user_tables t ON s.relname = t.relname
WHERE s.idx_scan = 0 AND t.n_live_tup > 0
  AND s.indexrelname NOT IN (SELECT conname FROM pg_constraint);

-- bloat: tables with significant dead tuple ratio
SELECT relname AS tablename, n_dead_tup, n_live_tup
FROM pg_stat_user_tables
WHERE n_live_tup > 0 AND n_dead_tup > n_live_tup * 0.1;

-- sequence_wraparound: sequences > 80% exhausted
SELECT sequencename, last_value, max_value
FROM pg_sequences
WHERE max_value > 0 AND last_value IS NOT NULL
  AND last_value::float / max_value > 0.8;
```
