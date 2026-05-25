# Contract — Edge runtime vault injection (`main/index.ts`)

**Scope**: The per-project `infra/supabase-template/volumes/functions/main/index.ts`, baked into each project's `functions` container via the existing compose template. Replaces the upstream stub.

## Inputs

- `Deno.env.get('SB_REF')` — the 20-char project ref (set by selfbase compose template).
- `Deno.env.get('SUPABASE_DB_URL')` — per-project Postgres connection string for `supabase_admin` (already set by template for other functions runtime needs).
- `Deno.env.get('SELFBASE_VAULT_TTL_MS')` — optional override; default `5000`.
- `./reserved-secrets.json` — materialized at api/worker build time from `packages/shared/src/reserved-secrets.ts`.

## Behavior

For every incoming HTTP request that triggers a user worker spawn:

1. Call `getEnvVars()` → returns `Record<string, string>`.
   - If cache fresh (age < TTL): return cached map.
   - If cache stale or empty: `SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE key_id IS NOT NULL`; filter out names in `RESERVED_SECRETS`; replace cache; return.
   - If query fails: log `[selfbase-vault] refresh failed for <ref>: <message>` (NEVER log values); return last cached map if any, else `{}`.
2. Merge with platform-reserved env (container process env wins on collision — defense in depth even though step 1 already filters them out).
3. Pass merged map as `envVars` to `EdgeRuntime.userWorkers.create({ servicePath, envVars, ... })`.

## Concurrency

A single shared in-flight refresh promise. Concurrent reads during a TTL miss await the same `SELECT`, then all resolve from the freshly populated cache. Verified by SC-010 (≤1 query per TTL window under 100 RPS × 5 secrets each).

## Observability

- INFO log on successful refresh: `[selfbase-vault] refreshed <N> secrets for <ref> in <ms>ms`
- WARN log on fallback to cached: `[selfbase-vault] refresh failed; serving cached <N> secrets`
- ERROR log when no cache exists and refresh fails: `[selfbase-vault] refresh failed; no cache; worker will spawn with no user secrets`

Never log secret values or full vault response bodies. Names only.

## Failure semantics

| Condition | Worker spawn behavior |
|---|---|
| Vault fresh, fetch succeeds | Spawn with full envVars from vault |
| Vault stale, refresh succeeds | Spawn with fresh envVars |
| Vault stale, refresh fails, cache exists | Spawn with last-cached envVars (logged WARN) |
| Vault stale, refresh fails, no cache | Spawn with `envVars = { ...platformReserved }` (no user secrets); function code sees `undefined` for every user-managed name (logged ERROR) |

## Contract test obligations

Vitest-driven unit tests against `getEnvVars()` with a mocked `pg` client:

1. Cache hit within TTL → no DB call.
2. Cache miss → one DB call; subsequent immediate call within TTL → no additional DB call.
3. 100 parallel calls during a miss → exactly one DB call resolves all.
4. Reserved name in DB response → filtered out of returned map.
5. DB throws → returns last cached map (or `{}` if first call); error logged with name list only.

Live verification (deferred to live-VM E2E in `tests/cli-e2e/`):
- Set `TEST_SECRET=alpha` via dashboard → invoke function → assert returns `'alpha'` within 10s.
- Update to `'beta'` → re-invoke → assert returns `'beta'` within 10s.
- `docker logs selfbase-<ref>-functions-1` during the above → assert zero restart events.
