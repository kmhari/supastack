# Data Model: Pooler-Reconciler Unit Tests (feature 019)

This feature adds no new database tables or schema changes. It is purely additive (test file only).

The following entities are the input/output surfaces the tests must construct as fixtures or assert on.

---

## Test Fixture Entities

### `InstFixture`
Minimal shape of a `supabase_instances` row as selected by the reconciler.

```ts
{ ref: string; status: 'running' | 'deleting' | 'paused' }
```

### `PoolerRowFixture`
Minimal shape of a `pooler_tenants` row as selected by the reconciler.

```ts
{
  ref: string;          // instanceRef
  externalId: string;   // same as ref in practice
  status: 'active' | 'failed' | 'pg_password_drift';
  updatedAt: Date;
}
```

### `SupavisorTenantFixture`
Shape returned by the mocked supavisor list endpoint.

```ts
{ external_id: string; db_host: string; db_port: number }
```

### `ReconcilerRunRowFixture`
Shape inserted into/queried from `reconciler_runs` during `startRun`.

```ts
{
  id: string;
  status: 'running' | 'failed' | 'success' | 'partial_failure';
  startedAt: Date;
  errorMessage: string | null;
}
```

---

## DB Mock Builder Chain

The reconciler uses Drizzle ORM's fluent builder. The mock must satisfy these chains:

| Call pattern | Used by | Mock return |
|---|---|---|
| `db().select(...).from(...).where(...).limit(1)` | `runSingleInstanceReconcile` fetching inst + pooler row | Array (0 or 1 element) |
| `db().select(...).from(SUPABASE_INSTANCES)` | `runFullReconcile` | Array of inst rows |
| `db().select(...).from(POOLER_TENANTS)` | `runFullReconcile` | Array of pooler rows |
| `db().update(...).set(...).where(...)` | `preflight` crash-recovery, `lastReconciledAt` stamp | Resolved (no return) |
| `db().insert(...).values(...).returning(...)` | `startRun` INSERT | Array with `{ id }` OR throws unique constraint error |
| `db().select(...).from(RECONCILER_RUNS).where(...).limit(1)` | `startRun` after unique-violation | Array with `{ id, startedAt }` |
| `db().execute(sql\`...\`)` | `preflight` GC sweep | Resolved (no return) |

---

## Classification Enum

Seven possible values returned by `classifyInstance` (private) or classified by `runFullReconcile` for orphans:

```ts
type Classification =
  | 'consistent'
  | 'missing_pooler_row'
  | 'failed_stale'
  | 'missing_in_supavisor'
  | 'instance_gone'
  | 'orphan_in_supavisor'
  | 'pg_password_drift';
```

## Constants (from source — do not redeclare in tests; import or inline)

| Constant | Value | Used in |
|---|---|---|
| `STALE_FAILED_MS` | `3_600_000` (1h in ms) | `classifyInstance` boundary |
| `STALE_RUNNING_MS` | `3_600_000` (1h in ms) | `preflight` crash-recovery cutoff |
| `RETAIN_RUNS` | `30` | GC sweep limit |
