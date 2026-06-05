# 107 — API host-parity: serve the platform + Management API at `api.<apex>` (scoped CORS)

Spec: [specs/107-api-host-parity/spec.md](../../specs/107-api-host-parity/spec.md) ·
Plan: [specs/107-api-host-parity/plan.md](../../specs/107-api-host-parity/plan.md)

## What & why

Mirror Supabase Cloud's host nomenclature: the dashboard now calls the **platform + Management API at a dedicated `api.<apex>` host** (like `api.supabase.com/platform/*` + `/v1/*`) instead of the apex root (feature 086). Because the Studio is served at the apex and the API is on `api.<apex>`, the calls are **cross-origin** → the api serves a scoped CORS layer.

## The changes

- **Scoped CORS (`apps/api/src/config/cors-config.ts`, new single source).** Replaced `server.ts:197`'s `app.register(cors, { origin: true, credentials: true })` — which reflected **any** origin with credentials (a latent permissive posture) — with:
  - `Access-Control-Allow-Origin` = **exact** `https://<apex>` only (never `*`); dev origins (`localhost:5173/3000`) only when `NODE_ENV !== production`.
  - allowed headers = `authorization, content-type, …, x-connection-encrypted, x-pg-application-name, x-request-id` (the Studio's HAR-observed custom set + supabase-js/postgrest standards) — **one auditable place**, review on Studio upgrade.
  - methods `GET/POST/PUT/PATCH/DELETE/OPTIONS`; `Allow-Credentials: false`; `Max-Age: 600`.
  - **FR-006 resolved**: dashboard→API auth is Bearer (`auth.ts:82`), no XHR cookie. The only cookie (`sb-access-token`) is read solely by the `/v1/oauth/authorize` browser-**navigation** (`oauth/authorize.ts:127`), anchored at the apex (dual-served) — unaffected by CORS or the dashboard-base move.
- **The `api.<apex>` host route already existed** (`caddy-config.ts:266` `apiHostRoute` → whole host to `api:3001`, terminal; the api 404s non-routes, so it doesn't serve the studio). So FR-008 was already met — the spec's "incidental via fallback" premise was wrong. Added an explicit `api.<apex>` block to the boot `Caddyfile` for **cold-boot parity** (mirrors `mcp.<apex>`).
- **Studio base** (`infra/docker-compose.yml`): `NEXT_PUBLIC_API_URL: "https://api.${SUPASTACK_APEX}"` (was `https://${SUPASTACK_APEX}`). `NEXT_PUBLIC_GOTRUE_URL` **unchanged** (apex `/auth/v1`, same-origin login).

## Net: a security improvement too

The old `{ origin: true, credentials: true }` is gone. The credentialed-capable API now grants CORS only to the exact dashboard origin (FR-004/FR-010).

## Tests

- `apps/api/tests/unit/cors-policy.test.ts` (5): exact-origin echo + preflight header allow-list (US1); foreign-origin reject + never-`*` + env scoping (US2).
- `apps/api/tests/unit/caddy-config-api-host.test.ts` (3): the `api.<apex>` host route → `api:3001`, terminal, before the dashboard fallback, no studio fan-out.
- No drift: full `@supastack/api` suite green (624); `/v1` OpenAPI contract test green (Constitution IV); `platform-proxy.test` unaffected.

## Deploy (coordinated)

Apex dual-serves `/platform` + `/v1` (FR-012), so the api side is independently safe.

```bash
# 1. api first — scoped CORS live at api.<apex> (the host route already exists; the
#    boot Caddyfile gains the explicit block, runtime caddy-config reloads on boot).
sudo docker compose build api && sudo docker compose up -d api
# verify cross-origin BEFORE repointing the Studio:
curl -s -D- -o /dev/null -H "Origin: https://<apex>" https://api.<apex>/platform/profile | grep -i access-control-allow-origin   # → https://<apex>
curl -s -D- -o /dev/null -H "Origin: https://evil.example" https://api.<apex>/platform/profile | grep -i access-control-allow-origin || echo "no foreign grant ✓"
# 2. rebuild Studio with the new base (NEXT_PUBLIC_* baked at build)
rm -rf "$STUDIO_SOURCE_DIR/apps/studio/.next"
sudo docker compose up -d --force-recreate studio
# 3. in the browser: every page loads with 0 CORS errors; sign-in works (apex /auth/v1);
#    SQL editor / pg-meta query + a mutation succeed cross-origin.
```

## Rollback

Revert `NEXT_PUBLIC_API_URL` → `https://${SUPASTACK_APEX}` + wipe `.next` + `--force-recreate studio`. Same-origin restored; no api/CORS change needed (apex dual-serves). The scoped CORS can stay (it only tightened the prior posture).
