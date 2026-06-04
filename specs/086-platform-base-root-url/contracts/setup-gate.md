# Contract — Setup-completion gate (US5)

DB-state-driven Caddy route. Zero Studio source changes; no per-request cost; fails safe to `/setup`.

## Signal

`setup_state.completed_at` (control-plane DB singleton) — the authoritative completion flag (same state `GET /api/v1/setup/status` exposes as `{ open }`, where `open === completed_at === null`). No on-disk sentinel; `caddy-config.ts` already reads control-plane DB state.

## `apps/api/src/services/caddy-config.ts`

In `buildCaddyConfig()` (after the existing `installation` read):
```
let setupDone = false;
try {
  const r = await db().select({ c: schema.setupState.completedAt }).from(schema.setupState).limit(1);
  setupDone = r[0]?.c != null;
} catch { setupDone = false; }   // fail-safe: gate when state is unknowable
```
Then the apex `dashboardSubroutes` **catch-all** (currently `reverse_proxy studio:3000`) becomes conditional:
- `setupDone === true` → catch-all `reverse_proxy studio:3000` (today's behavior).
- `setupDone === false` → catch-all `static_response 302` with `Location: /setup` (the gate).

The 302 replaces **only the final catch-all**. Handles 1–8 (`/.well-known/*`, `/api/*`, `/v1*`, `/platform/*`, `/auth/v1/*`, websocket, `/internal/*`, `/setup*`) stay intact so setup itself works. Per-instance `<ref>.<apex>` data-plane hosts are separate terminal routes and MUST NOT be gated.

## `apps/api/src/routes/setup.ts`

`reloadCaddy()` on completion MUST be **unconditional** (today it only fires when `body.apexDomain` is set, `setup.ts:111`). After setup writes `setup_state.completed_at`, the reload re-runs `buildCaddyConfig()` → `setupDone=true` → the gate is dropped, `/` serves studio.

## `apps/caddy/Caddyfile` (boot skeleton, `:80` + `:443`)

The boot config can't read the DB, so its catch-all MUST default to the **gated** state: `respond` / `redir /setup 302` instead of `reverse_proxy studio:3000`. A fresh box (before any runtime `/load`) thus redirects to `/setup`; the first post-setup `reloadCaddy()` swaps in the studio catch-all.

## Acceptance

- Pre-setup (`setup_state.completed_at IS NULL`): `GET /` , `/dashboard`, `/dashboard/project/<ref>` → 302 `Location: /setup`. `/setup`, `/api/v1/setup/status`, `/.well-known/acme-challenge/*` still reachable.
- Complete setup → `reloadCaddy()` → `GET /` → proxied to studio (200), no redirect.
- DB read error in `buildCaddyConfig()` → gated (302→/setup), never an open broken studio.
- `<ref>.<apex>` data-plane host → unaffected (reaches Kong) pre- and post-setup.
