# Tasks: Feature 024 — Sessions env_file fix (closes #77)

**Input**: Design documents from `specs/024-sessions-env-file/`

**Prerequisites**: plan.md ✓ | spec.md ✓ | research.md ✓

**Tests**: Not explicitly requested. One collected-but-skipped integration stub added (project convention).

**Organization**: Foundational API/logic layer first (T001–T003), then compose + migration runtime layer (T004–T006), then polish.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[US1]**: Compose + migration story (runtime effect on instances)

---

## Phase 1: Setup

**Purpose**: No new packages, no DB migrations, no new infrastructure. Existing monorepo.

*No setup tasks required.*

---

## Phase 2: Foundational — env-field-mapper API logic

**Purpose**: The core semantic fix. Defines the duration transform and promotes both fields. Must complete before compose/migration work can be verified end-to-end.

**⚠️ CRITICAL**: T004–T006 depend on this phase being correct — the `.env` write path is only exercised once these fields are `honored`.

- [X] T001 Add `secondsToDuration` transform helper near the `joinComma` function in `apps/api/src/services/env-field-mapper.ts`:
  ```ts
  function secondsToDuration(v: unknown): string {
    const n = Number(v);
    return n > 0 ? `${n}s` : '';
  }
  ```
  Returning `''` for `0`/`null` triggers the existing `removeEnvEntry` path in `runtime-config-store` (line 320–322), making `0` mean "absent from container" → GoTrue uses nil → no limit.

- [X] T002 Add `sessions_timebox` and `sessions_inactivity_timeout` as `honored` entries in the `SESSIONS_PW_ETC_HONORED` record in `apps/api/src/services/env-field-mapper.ts`:
  ```ts
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
  Insert after the `sessions_single_per_user` and `sessions_tags` entries (lines ~414–418).

- [X] T003 Remove the two `STORED_ONLY_REASONS` assignments for these fields and update the header comment counts in `apps/api/src/services/env-field-mapper.ts`:
  - Delete lines: `STORED_ONLY_REASONS['sessions_timebox'] = ...` and `STORED_ONLY_REASONS['sessions_inactivity_timeout'] = ...` (~lines 501–504)
  - Update header comment: `honored: 169` → `honored: 171` and `stored_only: 59` → `stored_only: 57`

**Checkpoint**: `honored` count is now 171. `pnpm --filter api build` must pass cleanly before proceeding.

---

## Phase 3: User Story 1 — Compose + Migration (runtime effect)

**Goal**: The `env_file: .env` directive makes absent `.env` lines → absent container env vars. All running instances get their auth container recreated once to pick up the new compose config.

**Independent Test**: After T004–T006 deploy, PATCH `sessions_timebox = 3600` for a project → verify `GOTRUE_SESSIONS_TIMEBOX=3600s` appears in that instance's `.env` file and the GoTrue container respects it.

- [X] T004 [US1] Add `env_file: .env` to the `auth:` service in `infra/supabase-template/docker-compose.yml`, inserted before the existing `environment:` block:
  ```yaml
    auth:
      image: supabase/gotrue:v2.186.0
      ...
      env_file:
        - .env
      environment:
        GOTRUE_API_HOST: 0.0.0.0
        ...
  ```
  The two duration fields (`GOTRUE_SESSIONS_TIMEBOX`, `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT`) must remain absent from the `environment:` block (they were already omitted — confirm no `${GOTRUE_SESSIONS_*}` lines exist for them).

- [X] T005 [US1] Create `apps/worker/src/jobs/migrate-auth-env-file.ts` — boot-time one-shot migration job:
  ```ts
  import { eq } from 'drizzle-orm';
  import { db, schema } from '@supastack/db';
  import { composeUpService } from '@supastack/docker-control';
  import path from 'node:path';
  import { log } from '../logger.js';

  const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';

  export async function runMigrateAuthEnvFile(): Promise<void> {
    const projects = await db()
      .select({ ref: schema.project.ref })
      .from(schema.project)
      .where(eq(schema.project.status, 'running'));

    for (const p of projects) {
      try {
        const composeDir = path.join(INSTANCES_DIR, p.ref);
        const projectName = `supastack-${p.ref}`;
        await composeUpService({ composeDir, projectName }, 'auth');
        log.info({ ref: p.ref }, 'migrate-auth-env-file: auth recreated');
      } catch (err) {
        log.error({ ref: p.ref, err }, 'migrate-auth-env-file: failed, skipping');
      }
    }
  }
  ```
  Check `apps/worker/src/logger.ts` and existing jobs (e.g. `pooler-reconciler.ts`) to confirm the exact logger import pattern and `composeUpService` call signature used in the worker.

- [X] T006 [US1] Call `runMigrateAuthEnvFile()` at worker boot in `apps/worker/src/main.ts` — fire-and-forget after the BullMQ queues are set up:
  ```ts
  import { runMigrateAuthEnvFile } from './jobs/migrate-auth-env-file.js';
  // ...
  runMigrateAuthEnvFile().catch((err) =>
    log.error({ err }, 'migrate-auth-env-file: boot migration failed'),
  );
  ```

**Checkpoint**: `pnpm --filter worker build` passes. Deploying worker to VM and watching logs for `migrate-auth-env-file: auth recreated` confirms migration ran.

---

## Phase 4: Polish & Cross-Cutting

- [X] T007 [P] Add collected-but-skipped integration test stub in `tests/integration/024-sessions-env-file.test.ts` (project convention — tests collected but not executed in CI without a live stack):
  ```ts
  import { describe, it } from 'vitest';

  describe('sessions env_file fix (#77)', () => {
    it.skip('PATCH sessions_timebox positive value → GOTRUE_SESSIONS_TIMEBOX written to .env', () => {
      // PATCH { sessions_timebox: 3600 }
      // read instance .env → assert contains GOTRUE_SESSIONS_TIMEBOX=3600s
    });

    it.skip('PATCH sessions_timebox 0 → GOTRUE_SESSIONS_TIMEBOX line absent from .env', () => {
      // PATCH { sessions_timebox: 0 }
      // read instance .env → assert GOTRUE_SESSIONS_TIMEBOX line does not exist
    });
  });
  ```

- [X] T008 [P] Run `pnpm --filter api build` — verify no TypeScript errors from env-field-mapper changes

- [X] T009 [P] Run `pnpm --filter worker build` — verify no TypeScript errors from migration job

---

## Dependencies & Execution Order

- **Phase 2 (T001–T003)**: No dependencies — start immediately. All in the same file; run sequentially.
- **Phase 3 (T004–T006)**: T004 can start after T003. T005 and T006 are sequential (T006 imports T005). T004 and T005 touch different files → can run in parallel with each other.
- **Phase 4 (T007–T009)**: T008 depends on T003; T009 depends on T006. T007 is independent.

### Parallel Opportunities within Phase 3

```
Parallel batch (after T003):
  Task T004: Add env_file to docker-compose.yml
  Task T005: Create migrate-auth-env-file.ts

Sequential after batch:
  Task T006: Wire migration into main.ts (imports T005)
```

---

## Implementation Strategy

### MVP (T001–T006, ~1 hour)

1. T001 → T002 → T003 (env-field-mapper — the core)
2. T004 ‖ T005 (compose change + migration job in parallel)
3. T006 (wire migration at boot)
4. **STOP and VALIDATE**: `pnpm --filter api build && pnpm --filter worker build`
5. Deploy to VM — watch for `migrate-auth-env-file` log entries

### Full Delivery (add T007–T009)

6. T007 (test stub), T008 (api build check), T009 (worker build check) — all parallelizable

---

## Notes

- `secondsToDuration` returns `''` for `0` and `null` — this hits the existing `removeEnvEntry` path in `runtime-config-store.ts:320–322`. No change to `runtime-config-store.ts` needed.
- `env_file: .env` precedence: `environment:` block wins for any key listed in both. All existing `GOTRUE_*` vars remain in `environment:` and are unaffected.
- Migration is idempotent: `composeUpService` skips recreate if compose config is unchanged (Docker detects no diff). Safe to re-run on worker restart.
- GoTrue validates `*time.Duration` pointer fields: `0` and `""` both rejected. Only absent = disabled. The transform enforces this.
