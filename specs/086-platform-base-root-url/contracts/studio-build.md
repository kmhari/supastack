# Contract — Studio build + coordinated deploy (P1)

## Compose change (`infra/docker-compose.yml`, studio service env)

```
- NEXT_PUBLIC_API_URL: "https://${SUPASTACK_APEX}/api/v1"
+ NEXT_PUBLIC_API_URL: "https://${SUPASTACK_APEX}"
```

**Unchanged** (do NOT touch): `NEXT_PUBLIC_GOTRUE_URL: "https://${SUPASTACK_APEX}/auth/v1"` (login), `NEXT_PUBLIC_IS_PLATFORM: "true"`, `NEXT_PUBLIC_BASE_PATH: "/dashboard"`.

## Rebuild procedure (VM)

`NEXT_PUBLIC_*` are inlined at `next build`, not read at runtime. The studio container only rebuilds when `.next/BUILD_ID` is absent, so a value change requires wiping the cache:

```
rm -rf "$STUDIO_SOURCE_DIR/apps/studio/.next"
sudo docker compose up -d --force-recreate studio
```

## Coordinated/atomic deploy order

The three P1 edits MUST land together (a root-base Studio without the Caddy `/v1*` route 404s its management calls):
1. API: root `platformMiscRoutes` mount + Caddy `/v1*` in `caddy-config.ts` → `docker compose build api && up -d api` (reloads Caddy runtime config).
2. Caddyfile boot skeleton `/v1*` rule (for cold boots).
3. Compose `NEXT_PUBLIC_API_URL` flip → wipe `.next` → `--force-recreate studio`.
4. Verify (quickstart). Only then remove the `/api/v1/v1` shim + `/api/v1` platform mounts.

## Rollback

Revert the Studio image (restores the `/api/v1` base, still served by the retained `/api/v1` platform mounts + shim) together with the API/Caddy revert. Because the shim + `/api/v1` mounts are removed only *after* the rebuilt Studio is confirmed live, rollback before that step is a clean image revert.

## Acceptance

- After deploy: the studio at `https://<apex>/dashboard` loads; network panel shows `/platform/*` + `/v1/*` (no `/api/v1/v1/*`).
- Login still succeeds (token POST to `/auth/v1/token`).
