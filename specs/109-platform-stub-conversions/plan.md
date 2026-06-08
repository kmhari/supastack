# Implementation Plan: Platform Stub Conversions (Tier 1–4)

**Branch**: `109-platform-stub-conversions` | **Date**: 2026-06-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/109-platform-stub-conversions/spec.md`

## Summary

Convert 20 platform stub endpoints (Tier 1–4) in `apps/api/src/routes/platform-misc.ts` to return real data. No new infrastructure, no migrations, no RBAC matrix changes — all data already exists in the control-plane DB, per-instance Postgres, or implemented `/v1` handlers. Implementation is a series of targeted inline replacements within a single 4499-line route file.

## Technical Context

**Language/Version**: TypeScript, Node 20 ESM

**Primary Dependencies**: Fastify (`app.inject`, route decorators), Drizzle ORM (`db()`, `schema.*`), `withPerInstancePg` (per-instance Postgres client)

**Storage**: Control-plane PostgreSQL (Drizzle) for Tier 1–3 endpoints; per-instance Postgres via `withPerInstancePg` for Tier 4 lint queries

**Testing**: Vitest (unit tests in `apps/api/tests/unit/`)

**Target Platform**: Node 20 server (existing Docker compose stack)

**Project Type**: API server — route-level stub replacements only

**Performance Goals**: Lint queries ≤ 5 s on a project with up to 100 tables (read-only advisory queries against `pg_stat_*`)

**Constraints**: Single source file (`platform-misc.ts`). No new deps. No migrations. No `/v1/*` modifications. `fwdHeaders` helper already defined at line 712 in scope.

**Scale/Scope**: 20 endpoints across 7 user stories, all within `platformMiscRoutes`

## Constitution Check

| Principle | Assessment |
|-----------|-----------|
| **I — Idempotent migrations** | No new migrations. All required tables exist (`supabase_instances`, `audit_log`, `backups`). ✅ |
| **II — Secrets encrypted** | No new secrets handling. Delegation to `/v1/projects/:ref/secrets` relies on existing vault pathway. ✅ |
| **III — Authorize every privileged action** | Platform endpoints use `requireAuth` + org-membership DB check (consistent with all existing platform routes). Delegated `/v1` endpoints enforce RBAC internally. No new matrix actions needed. ✅ |
| **IV — Supabase compatibility** | No `/v1/*` modifications. Delegated requests use existing authenticated `/v1` routes. ✅ |
| **V — Worker owns per-instance state** | `DELETE /platform/projects/:ref/readonly` delegates to `POST /v1/projects/:ref/restore`, which already enqueues a `lifecycleQueue` resume job. ✅ |
| **VI — Spec-driven delivery** | Spec, plan, tasks, implement lifecycle followed. ✅ |

## Project Structure

### Documentation (this feature)

```text
specs/109-platform-stub-conversions/
├── plan.md              ← this file
├── research.md          ← decision rationale
├── contracts/           ← endpoint shapes
│   └── platform-stubs.md
├── quickstart.md        ← test scenarios
└── tasks.md             ← /speckit-tasks output
```

### Source Code (single file)

```text
apps/api/src/routes/platform-misc.ts   ← all 20 stub replacements
apps/api/tests/unit/platform-stub-conversions.test.ts  ← new unit tests
```

## Architecture

All 20 endpoints live inside the `platformMiscRoutes` async function in `platform-misc.ts`. The implementation strategy follows four patterns already established in that file:

### Pattern A — DB status read (Tier 1: pause/status, readonly, upgrade/status)

```typescript
const user = app.requireAuth(req);
const [inst] = await db()
  .select({ status: schema.supabaseInstances.status, updatedAt: schema.supabaseInstances.updatedAt })
  .from(schema.supabaseInstances)
  .innerJoin(schema.organizationMembers, eq(schema.organizationMembers.organizationId, schema.supabaseInstances.orgId))
  .where(and(eq(schema.supabaseInstances.ref, req.params.ref), eq(schema.organizationMembers.userId, user.id)))
  .limit(1);
if (!inst) return reply.status(404).send({ error: 'Project not found' });
```

### Pattern B — Audit log query (Tier 2: /audit, /activity)

Same as the org-level audit at line 1568, filtered by `targetId = ref` (project events logged with `targetKind: 'instance'`, `targetId: ref`).

### Pattern C — app.inject delegation (Tier 3: network-bans, network-restrictions, ssl-enforcement, functions/secrets)

```typescript
app.requireAuth(req);
const resp = await app.inject({ method: 'GET', url: `/v1/projects/${req.params.ref}/ssl-enforcement`, headers: fwdHeaders(req) });
return reply.status(resp.statusCode).send(resp.json<unknown>());
```

`fwdHeaders` is already defined in scope at line 712.

### Pattern D — withPerInstancePg lint queries (Tier 4: run-lints)

```typescript
const rows = await withPerInstancePg(req.params.ref, async (pg) => {
  const res = await pg.query(LINT_QUERIES[name]);
  return res.rows;
});
```

Five advisory lint checks: no_rls, duplicate_index, unused_index, bloat, sequence_wraparound (see research.md for SQL).

## Endpoint Mapping

| Tier | Endpoint | Current stub | Real implementation |
|------|----------|-------------|---------------------|
| 1 | GET pause/status | `{initiated_at:null, status:'not_pausing'}` | DB status → paused? use updatedAt : null |
| 1 | GET readonly | `{enabled:false}` | `enabled = inst.status === 'paused'` |
| 1 | DELETE readonly | 204 no-op | delegate → POST /v1/projects/:ref/restore |
| 1 | GET upgrade/status | `{status:'not_upgrading'}` | restoring → `{status:'upgrading'}` else not_upgrading |
| 2 | GET /audit | `{result:[],count:0}` | audit_log WHERE targetId=ref |
| 2 | GET /activity | `[]` | audit_log WHERE targetId=ref, chronological |
| 3a | GET downloadable-backups | `{backups:[]}` | backups WHERE ref+status=completed |
| 3b | GET network-bans | `{banned_ipv4_addresses:[]}` | delegate → /v1/projects/:ref/network-bans |
| 3b | DELETE network-bans | 204 no-op | delegate → DELETE /v1/projects/:ref/network-bans |
| 3b | GET network-restrictions | `{entitlement:'disallowed',...}` | delegate → /v1/projects/:ref/network-restrictions |
| 3b | POST network-restrictions/apply | echo body | delegate → /v1/projects/:ref/network-restrictions/apply |
| 3b | GET ssl-enforcement | static false | delegate → /v1/projects/:ref/ssl-enforcement |
| 3b | PUT ssl-enforcement | echo body | delegate → /v1/projects/:ref/ssl-enforcement |
| 3b | GET functions/secrets | `[]` | delegate → /v1/projects/:ref/secrets |
| 3b | POST functions/secrets | 201 {} | delegate → /v1/projects/:ref/secrets |
| 4 | GET run-lints | `[]` | withPerInstancePg → 5 lint queries |
| 4 | GET run-lints/:name | `[]` | filter to named check |

## Data Model

No new tables or migrations required. Existing tables used:
- `supabase_instances` — status, updatedAt, orgId
- `organization_members` — userId, organizationId (org membership check)
- `audit_log` — targetId, targetKind, action, actorUserId, createdAt, payload
- `backups` — instanceRef, seq, startedAt, completedAt, sizeBytes, status

## Implementation Notes

### Stubs inside a loop (pause/status and run-lints)

`pause/status` and `run-lints` are currently part of a `for (const path of [...])` loop (line 1321–1347). They must be **extracted from the loop** and registered as standalone `app.get` calls with real implementations.

### run-lints stub at line 3119

`run-lints/:name` also has its own stub at line 3119. Replace that stub too.

### DELETE readonly delegation shape

Studio calls `DELETE /platform/projects/:ref/readonly` expecting 200 + a project object (same as `/v1/projects/:ref/restore`). Forward auth header only:
```typescript
const resp = await app.inject({ method: 'POST', url: `/v1/projects/${req.params.ref}/restore`, headers: { authorization: req.headers['authorization'] as string } });
return reply.status(resp.statusCode).send(resp.json<unknown>());
```

### Lint query return shape

Each lint result: `{ name: string, title: string, level: 'INFO'|'WARN'|'ERROR', description: string, metadata: Record<string, unknown> }`. Named checks: `no_rls`, `duplicate_index`, `unused_index`, `bloat`, `sequence_wraparound`.

## Testing Strategy

- Unit tests in `apps/api/tests/unit/platform-stub-conversions.test.ts`
- Mock `@supastack/db` (DB chain), `withPerInstancePg`, and `app.inject` (for delegation tests)
- Happy path + at least one sad path (401, 404) per endpoint group
- Existing test suite must not regress (`pnpm --filter @supastack/api test`)

## Complexity Tracking

**Not applicable** — no constitution exceptions required.
