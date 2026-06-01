# Studio IS_PLATFORM Mock API

A minimal Express server that impersonates Supabase's platform API, letting Studio (built with `NEXT_PUBLIC_IS_PLATFORM=true`) run fully without a real Cloud backend.

## Why this exists

Supabase Studio gates several UI sections behind `IS_PLATFORM=true` — most notably:
- **Auth → Emails** (Templates + SMTP settings) — hidden in self-hosted Studio by `features.emails && isPlatform`

These features would be useful in supastack. This mock lets us explore the full IS_PLATFORM UI to understand what backend APIs those pages need, before porting them to supastack's own dashboard.

## What gets mocked vs proxied

| Path | Behaviour |
|---|---|
| `/platform/profile` | Mock — hardcoded local user |
| `/platform/organizations` | Mock — single "Local Org" |
| `/platform/projects` | Mock — single "Local Project" with `ref=localproject` |
| `/platform/projects/:ref` | Mock — ACTIVE_HEALTHY project |
| `/platform/auth/:ref/config` | **Proxied** → Kong `:8000/auth/v1/admin/config` |
| `/platform/pg-meta/:ref/*` | **Proxied** → pg-meta `:8081` |
| All billing / stripe / integrations | Mock — empty arrays/objects |
| Unknown GET routes | Mock — `{}` (logged as UNHANDLED) |
| Unknown non-GET routes | `204 No Content` |

## Two source patches needed

Because `NEXT_PUBLIC_IS_PLATFORM` is baked at build time, Studio needs to be rebuilt:

1. **`apps/studio/lib/auth.tsx`** — `alwaysLoggedIn={!IS_PLATFORM}` → `alwaysLoggedIn={true}`  
   (IS_PLATFORM mode normally requires Cloud sign-in; this bypasses it)

2. **`apps/studio/components/layouts/AuthLayout/AuthLayout.utils.ts`** — `features.emails && isPlatform` → `features.emails`  
   (removes the platform gate from the Emails sidebar entry)

## Deploy

```bash
chmod +x scripts/studio-mock-api/deploy.sh
./scripts/studio-mock-api/deploy.sh
```

This will:
1. Rsync the mock server to `/opt/studio-mock-api` on the VM
2. Install npm deps
3. Expose pg-meta on host port 8081
4. Apply the two source patches
5. Rebuild Studio with `NEXT_PUBLIC_IS_PLATFORM=true` and `NEXT_PUBLIC_API_URL=http://148.113.1.164:4000`
6. Restart Studio container
7. Start the mock API server in the background

## Access

- Studio: `http://148.113.1.164:3000/project/localproject/auth/templates`
- Mock API: `http://148.113.1.164:4000/platform/profile`
- Mock logs: `ssh ubuntu@148.113.1.164 'tail -f /tmp/studio-mock-api.log'`

## Env vars

| Var | Default | Notes |
|---|---|---|
| `PORT` | `4000` | Mock API port |
| `KONG_URL` | `http://localhost:8000` | For proxying auth config |
| `PG_META_URL` | `http://localhost:8081` | For proxying pg-meta |
| `SERVICE_KEY` | _(from .env)_ | GoTrue service-role JWT |
| `PROJECT_REF` | `localproject` | Must match Studio URL |
