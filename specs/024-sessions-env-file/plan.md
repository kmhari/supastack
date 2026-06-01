# Implementation Plan: Feature 024 — Sessions env_file fix

**Branch**: `main` | **Date**: 2026-06-01 | **Spec**: [spec.md](spec.md)

## Summary

Add `env_file: .env` to the GoTrue auth service in the per-instance compose template so
that absent `.env` lines → absent container env vars. This unblocks promoting
`sessions_timebox` and `sessions_inactivity_timeout` from `stored_only` → `honored`,
closing the last two broken fields on the Auth → Sessions dashboard page.

The per-instance `.env` file and its write path (`runtime-config-store`) already exist.
No new infrastructure is needed — this is a compose one-liner plus two field promotions
plus a duration transform.

## Technical Context

**Language/Version**: TypeScript (Node 20), Docker Compose v2

**Primary Dependencies**: GoTrue v2.186.0 (supabase/gotrue), BullMQ worker, Drizzle ORM

**Storage**: Per-instance `.env` at `/var/supastack/instances/<ref>/.env`

**Testing**: Vitest (unit), behavioral parity bash harness (`tests/integration/`)

**Target Platform**: Linux (Docker Compose stack on Ubuntu VM)

**Project Type**: Self-hosted Supabase control plane

**Performance Goals**: N/A — config write is infrequent

**Constraints**: GoTrue rejects `0` and `""` for `*time.Duration` pointer fields.
`0` in the API/UI means "disabled" → must translate to env line being absent.

**Scale/Scope**: Affects all running per-instance auth containers on PATCH of either field.

## Constitution Check

Per CLAUDE.md project conventions:

| Gate | Status | Notes |
|---|---|---|
| Migrations idempotent | ✅ | No new migrations needed |
| Additive schema changes | ✅ | No schema changes |
| RBAC: new endpoint | ✅ | No new endpoints |
| Tests cover security-sensitive bits | ✅ | Unit + behavioral test |
| Compose change needs per-instance migration | ✅ REQUIRED | One-time `composeUpService('auth')` per instance |

## Project Structure

### Documentation (this feature)

```text
specs/024-sessions-env-file/
├── plan.md          ← this file
├── research.md      ← Phase 0 output
├── data-model.md    ← Phase 1 output
└── tasks.md         ← /speckit-tasks output
```

### Source Code (files to touch)

```text
infra/supabase-template/docker-compose.yml         ← add env_file: .env to auth service
apps/api/src/services/env-field-mapper.ts          ← promote 2 fields + add duration transform
apps/worker/src/jobs/migrate-auth-env-file.ts      ← new boot-time migration job
apps/worker/src/main.ts                            ← call migration job at boot
tests/integration/024-sessions-env-file.test.ts   ← behavioral test stub
```

---

## Phase 0: Research

### R-001 — Docker Compose `env_file:` + `environment:` precedence

**Decision**: `environment:` takes precedence over `env_file:` when both define the same
key. The two duration fields (`sessions_timebox`, `sessions_inactivity_timeout`) are
already absent from the `environment:` block — they will flow via `env_file:` only.
All other `GOTRUE_*` vars remain in `environment:` and continue to be substituted from
`.env` as before — no change to them.

**Rationale**: Adding `env_file: .env` alongside existing `environment:` is additive and
non-breaking. The `environment:` entries win for any key listed in both.

**Alternatives considered**: `--config-dir` live-reload (issue #77 original proposal) —
deferred; requires a GoTrue version bump and a bind-mount.

### R-002 — Duration transform: integer seconds → Go duration string

**Decision**: The Management API schema sends `sessions_timebox` as
`z.number().min(0).nullable().optional()` (integer seconds). GoTrue expects a Go duration
string (e.g. `"3600s"`). Transform: `n => n > 0 ? `${n}s` : ''`.
Returning `''` when `n === 0` or `null` triggers the existing `removeEnvEntry` path in
`runtime-config-store` (line 322) — env line is deleted, GoTrue sees `nil`, no limit.

**Rationale**: Mirrors how Supabase Cloud handles `0` — translate to absent env var.

### R-003 — Migration for existing instances

**Decision**: A boot-time function in `apps/worker/src/main.ts` that:
1. Queries all `project` rows with `status = 'active'`
2. For each, calls `composeUpService(ctx, 'auth')` — Docker skips recreate if compose
   config unchanged (idempotent on re-run)
3. On failure per instance: log error + skip, continue to next (best-effort)
4. No DB tracking flag needed — re-run on worker restart is safe

**Rationale**: `composeUpService` is idempotent. Best-effort mirrors pooler-reconciler
pattern. Auth downtime per instance: ~5–10s (one-time).

---

## Phase 1: Design & Contracts

### Data model

No new DB entities. No migrations.

Per-instance `.env` gains two new optional lines when the fields are set to a positive
value:

```
GOTRUE_SESSIONS_TIMEBOX=<N>s
GOTRUE_SESSIONS_INACTIVITY_TIMEOUT=<N>s
```

These lines are absent when the value is `0` or unset (GoTrue uses compiled default: nil).

### Compose change (infra/supabase-template/docker-compose.yml)

Add `env_file:` directive to the auth service, before `environment:`:

```yaml
  auth:
    image: supabase/gotrue:v2.186.0
    ...
    env_file:
      - .env          # direct pass-through; absent lines = absent vars
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      ...             # all existing lines unchanged
      # GOTRUE_SESSIONS_TIMEBOX and GOTRUE_SESSIONS_INACTIVITY_TIMEOUT intentionally
      # absent from environment: — they flow via env_file: only.
```

### env-field-mapper.ts changes

Add a duration transform helper and promote the two fields:

```typescript
function secondsToDuration(v: unknown): string {
  const n = Number(v);
  return n > 0 ? `${n}s` : '';
}

// In SESSIONS_PW_ETC_HONORED:
sessions_timebox: {
  kind: 'honored',
  envName: 'GOTRUE_SESSIONS_TIMEBOX',
  transform: secondsToDuration,
},
sessions_inactivity_timeout: {
  kind: 'honored',
  envName: 'GOTRUE_SESSIONS_INACTIVITY_TIMEOUT',
  transform: secondsToDuration,
},
```

Remove the two `STORED_ONLY_REASONS` entries. Update header comment: honored 169 → 171, stored_only 59 → 57.

### runtime-config-store.ts — no change needed

The existing `applyEnvAndRestart` logic handles `transform returns ''` → `removeEnvEntry`
(line 320–322). No code change required.

### Migration job (apps/worker/src/jobs/migrate-auth-env-file.ts)

```typescript
export async function runMigrateAuthEnvFile(db: Db, instancesDir: string): Promise<void> {
  const projects = await db.query.project.findMany({ where: eq(project.status, 'active') });
  for (const p of projects) {
    try {
      const ctx = makeComposeContext(p.ref, instancesDir);
      await composeUpService(ctx, 'auth');
      log.info({ ref: p.ref }, 'migrate-auth-env-file: auth recreated');
    } catch (err) {
      log.error({ ref: p.ref, err }, 'migrate-auth-env-file: failed, skipping');
    }
  }
}
```

Called from `apps/worker/src/main.ts` at boot (fire-and-forget).

### Contracts

No new API endpoints. `sessions_timebox` and `sessions_inactivity_timeout` were already
accepted and stored; now they also take effect. `_supastack.fieldStatus` for both flips
from `stored_only` → `honored` in `GET /v1/projects/:ref/config/auth`.

### Behavioral test (tests/integration/024-sessions-env-file.test.ts)

Collected-but-skipped (no live stack in CI):

```typescript
it.skip('sessions_timebox: PATCH positive value → env line written', async () => {});
it.skip('sessions_timebox: PATCH 0 → env line removed → GoTrue applies no limit', async () => {});
```

---

## Implementation sequence

1. `env-field-mapper.ts` — add `secondsToDuration`, promote 2 fields, remove stored_only entries, update counts
2. `docker-compose.yml` — add `env_file: .env` to auth service
3. `migrate-auth-env-file.ts` — new migration job (best-effort, log+skip on failure)
4. `worker/main.ts` — call migration job at boot
5. Integration test stub

## Risk

| Risk | Likelihood | Mitigation |
|---|---|---|
| `env_file:` + `environment:` conflict on existing vars | Low | `environment:` wins; all existing vars stay there |
| Migration auth downtime | Low | ~5–10s per instance, one-time, best-effort skip on failure |
| GoTrue rejects `Ns` duration format | Low | `time.ParseDuration("3600s")` confirmed valid in Go stdlib |
| Worker restart causes re-migration | Low | `composeUpService` is idempotent — Docker skips if unchanged |
