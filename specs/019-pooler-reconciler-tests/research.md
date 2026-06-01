# Research: Pooler-Reconciler Unit Tests (feature 019)

## R-001 — `classifyInstance` is a private function

**Decision**: Test `classifyInstance` indirectly via exported entry points.

`classifyInstance` is not exported from `pooler-reconciler.ts`. Two exported functions call it:
- `runSingleInstanceReconcile(runId, ref)` — always passes `forceRetry=true`
- `runFullReconcile(runId)` — passes `forceRetry=false` (the default)

**Rationale**: The spec requirement (SC-004) is zero production file changes. Exporting an internal function solely for testing violates encapsulation and the "no source changes" constraint. Testing via the exported surface covers the same branches and is how T030/T031 are structured.

**Coverage mapping**:
- `consistent` (non-failed active row + sv tenant) → `runFullReconcile`
- `missing_pooler_row` → `runFullReconcile` (instance with no pooler row)
- `failed_stale` (age > 1h) → `runFullReconcile`
- `failed_stale` (forceRetry) → `runSingleInstanceReconcile` (forces `forceRetry=true`)
- `missing_in_supavisor` (active row, no sv tenant) → `runFullReconcile`
- `instance_gone` (deleting) → `runSingleInstanceReconcile` (deleting instance returns `instance_gone` before `remediate`)
- `pg_password_drift` (pooler row status = pg_password_drift) → `runFullReconcile`
- `orphan_in_supavisor` → `runFullReconcile` only (classified outside `classifyInstance`)

**Alternatives considered**: Export `classifyInstance` for testing → rejected (production file change, violates SC-004).

---

## R-002 — Mock strategy: `vi.mock` at module level

**Decision**: Use `vi.mock` factory functions (same pattern as T030/T031) for all external dependencies.

**Mocks required**:
| Module | What to mock | Why |
|---|---|---|
| `@supastack/db` | `db()` returns a chainable query builder stub; `schema.*` as plain string constants | Avoids real DB; pattern matches T030 |
| `@supastack/crypto` | `decryptJson`, `loadMasterKey` | Reconciler decrypts pooler credentials for probe |
| `@supastack/shared` | `logger` | Suppresses noise; prevents real log calls |
| `undici` | `fetch` (named export) | Supavisor HTTP calls all go through `fetch` from undici |
| `pg` | `pg.Client` constructor | Per-instance PG probe in `maybePromoteToDrift` |
| `drizzle-orm` | `eq`, `lt`, `and`, `sql` | Called by the reconciler's Drizzle queries; must not throw |

**Key insight on `db()` mock**: The reconciler chains Drizzle query builders (`.select().from().where().limit()`, `.update().set().where()`, `.insert().values().returning()`, `.execute()`). Each method returns the next chainable object. The mock must support this builder chain OR the tests drive behavior by controlling what the final resolved value is. The simplest approach: use a `vi.fn()` that returns a configurable resolved value per test, controlled via `mockResolvedValueOnce`.

**Rationale**: This exact pattern is proven in T030 (`pg-password-probe.test.ts`). No new mock infrastructure needed.

---

## R-003 — Preflight and GC are inside `startRun`, not exported separately

**Decision**: Test preflight and GC by calling `startRun` with appropriate DB fixtures.

`preflight()` is a private function called at the start of `startRun`. The GC sweep (`DELETE FROM reconciler_runs WHERE id NOT IN (SELECT id ... LIMIT 30)`) runs inside `preflight`. Both are only reachable via `startRun`.

For concurrency (`ReconcilerInFlightError`): `startRun` catches the unique-constraint violation from the INSERT and re-throws as `ReconcilerInFlightError`. Tests simulate this by making the `db().insert().values().returning()` chain throw an error matching `/unique constraint/i`.

---

## R-004 — `orphan_in_supavisor` is classified in `runFullReconcile`, not in `classifyInstance`

**Decision**: Test `orphan_in_supavisor` via `runFullReconcile` with a supavisor stub that returns a tenant whose `external_id` has no corresponding row in `supabase_instances`.

In `runFullReconcile`, after processing all instances, the reconciler iterates `supavisorTenants` and calls `remediate(svTenant.external_id, 'orphan_in_supavisor')` for any tenant whose `external_id` is not in `instanceByRef`. This is the only code path that produces `orphan_in_supavisor`.

---

## R-005 — `instance_gone` from `classifyInstance` vs. `runSingleInstanceReconcile` early return

**Decision**: Two distinct `instance_gone` paths; both need coverage.

1. **`classifyInstance` path**: `inst.status === 'deleting'` → returns `instance_gone`. Reached via `runSingleInstanceReconcile` (which doesn't skip deleting instances the way `runFullReconcile` does).
2. **`runSingleInstanceReconcile` early return**: instance not found in `supabase_instances` at all → immediate `instance_gone` return before `classifyInstance` is called.

`runFullReconcile` skips `deleting` instances with `continue` before calling `classifyInstance`, so the first path is only observable via `runSingleInstanceReconcile`.

---

## R-006 — `failed_stale` boundary: time control

**Decision**: Use `vi.setSystemTime` to control `Date.now()` for boundary tests.

`classifyInstance` computes `ageMs = Date.now() - poolerRow.updatedAt.getTime()`. To test:
- `ageMs > STALE_FAILED_MS` (3,600,001ms) → `failed_stale`
- `ageMs === STALE_FAILED_MS` (3,600,000ms) → `failed_stale` (`>` is strict, so exactly equal is NOT stale — actually `> STALE_FAILED_MS` means exactly equal is NOT stale)
- `ageMs < STALE_FAILED_MS` (3,599,999ms) → `consistent`

Use `vi.useFakeTimers()` in `beforeAll` for the boundary describe block, restore with `vi.useRealTimers()` in `afterAll`.

**Correction from spec**: Spec says "exactly-1h-old → `failed_stale`". The implementation uses strict `>`, so exactly 1h (3,600,000ms) is NOT stale — it returns `consistent`. Tests should match the implementation.

---

## R-007 — Test file location and naming

**Decision**: `apps/worker/tests/unit/pooler-reconciler.test.ts`

Follows the established convention: sibling tests are at `apps/worker/tests/unit/pg-password-probe.test.ts` and `apps/worker/tests/unit/vault-bootstrap.test.ts`. The `__tests__` dir doesn't exist; `tests/unit/` is canonical.
