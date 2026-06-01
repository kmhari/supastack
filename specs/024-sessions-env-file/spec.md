# Feature 024 — Sessions env_file fix: honor timebox & inactivity_timeout

## Problem

`sessions_timebox` and `sessions_inactivity_timeout` are currently `stored_only` in
`env-field-mapper.ts` — the dashboard saves the values to the DB but they never reach the
GoTrue container at runtime (issue #77).

Root cause: Docker Compose's `${VAR:-}` syntax always emits an env line even when the
variable is unset, resulting in an empty string being passed to GoTrue. GoTrue's
`SessionsConfiguration.Validate()` rejects both empty strings and `0` for these
`*time.Duration` pointer fields — "must be positive when set". The only valid "disabled"
state is the env var being **absent** from the container.

## Solution

Add `env_file: .env` to the auth service in `infra/supabase-template/docker-compose.yml`.
The per-instance `.env` file already exists and is already written to by
`runtime-config-store`. With `env_file:`, absent lines → absent env vars → GoTrue sees
`nil` → sessions are unlimited (disabled). No compose `${VAR:-}` substitution needed.

In `runtime-config-store`, the write logic for these two fields:
- User sets positive value (e.g. `3600`) → write `GOTRUE_SESSIONS_TIMEBOX=3600s` to `.env`
- User sets `0` (meaning "never/disabled") → remove the line from `.env`

## Scope

### In scope
- Add `env_file: .env` to auth service in compose template
- Promote `sessions_timebox` + `sessions_inactivity_timeout` from `stored_only` → `honored` in `env-field-mapper.ts`
- Add duration transform (seconds integer → Go duration string e.g. `3600` → `3600s`) for these two fields
- Handle `0` as "remove line" sentinel in runtime-config-store
- Migration job: call `composeUpService('auth')` for all active instances at worker boot (best-effort: log + skip on failure, no DB tracking needed — re-run on worker restart is safe since compose skips recreate if config unchanged)
- Behavioral test: PATCH timebox → verify GoTrue respects it

### Out of scope
- GoTrue `--config-dir` live-reload (no restart on PATCH) — tracked separately
- Any other `env_file:` migration for other services

## Acceptance criteria

- [ ] `sessions_timebox` flips to `honored` in `env-field-mapper.ts`
- [ ] `sessions_inactivity_timeout` flips to `honored` in `env-field-mapper.ts`
- [ ] Setting timebox to a positive value in dashboard causes GoTrue to enforce it
- [ ] Setting timebox to `0` removes the env line and GoTrue applies no limit
- [ ] Existing running instances are migrated (auth container restarted once with updated compose)
- [ ] `GOTRUE_SESSIONS_TIMEBOX` and `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT` are absent from the `environment:` block in compose (no `${VAR:-}` lines for them)
- [ ] All existing honored auth-config fields continue to work (no regression)

## Clarifications

### Session 2026-06-01

- Q: If one instance's auth restart fails during migration, how should the job handle it? → A: Log & skip — best-effort pass, operator fixes stragglers. Mirrors pooler-reconciler pattern.
- Q: Should we track which instances have been migrated to avoid re-running on worker restart? → A: Re-run is fine — `composeUpService` is idempotent; Docker skips recreate if compose config is unchanged. No DB flag needed.

## Related
- Issue #77
- `apps/api/src/services/env-field-mapper.ts` — `STORED_ONLY_REASONS` entries for both fields
- `apps/api/src/services/runtime-config-store.ts` — `.env` write path
- `infra/supabase-template/docker-compose.yml` — auth service definition
- `packages/docker-control/src/compose-template.ts` — initial `.env` generation
