# Quickstart: URL Configuration page

**Audience**: developer about to implement / test this feature
**Plan**: [`plan.md`](./plan.md)

## Prerequisites

- Local dev environment running: `pnpm dev` from repo root.
- A project exists locally OR you're testing against the supaviser.dev VM.
- For VM tests: an admin PAT (`sbp_…`) for the target project.

## Local dev loop

```bash
# 1. Start the stack (api + worker + web + db + redis)
pnpm dev

# 2. Open the dashboard
open http://localhost:5173/dashboard

# 3. Pick a project, navigate to its URL Configuration page
# Path: /dashboard/project/<ref>/auth/url-configuration

# 4. Watch the auth container env after each save:
docker exec supastack-<ref>-auth-1 env | grep -E "SITE_URL|URI_ALLOW_LIST"
```

## Unit + component tests

```bash
cd apps/web
pnpm test redirect-url-helpers     # helper logic
pnpm test ProjectAuthUrlConfig     # component
```

## E2E test (against local dev)

```bash
cd apps/web
pnpm test:e2e url-configuration
```

Override target with env:
```bash
PLAYWRIGHT_BASE_URL=https://supaviser.dev \
PLAYWRIGHT_ADMIN_STORAGE_STATE=./tests/e2e/.auth/admin-storage-state.json \
PLAYWRIGHT_TEST_PROJECT_REF=znishgvglkafpmjkqspw \
pnpm test:e2e url-configuration
```

## Live-VM smoke (after deploy)

```bash
# 1. Deploy
rsync -az --exclude=node_modules apps/web/ ubuntu@148.113.1.164:/opt/supastack/apps/web/
ssh ubuntu@148.113.1.164 'cd /opt/supastack/infra && \
  sudo docker compose build web && sudo docker compose up -d web'

# 2. Open the page
open https://<ref>.supaviser.dev/dashboard/project/<ref>/auth/url-configuration
```

### Smoke 1: Site URL save
1. Enter `https://app.example.com` in the Site URL input.
2. Click Save changes.
3. Watch the restart toast flip from "Restarting…" to "Saved".
4. Verify: `ssh ubuntu@148.113.1.164 'sudo docker exec supastack-<ref>-auth-1 env | grep SITE_URL'`
   Expected: `GOTRUE_SITE_URL=https://app.example.com`

### Smoke 2: Add Redirect URLs (batch)
1. Click Add URL.
2. Enter `http://localhost:3000` in row 1.
3. Click "+ Add URL" inside the dialog. Enter `http://localhost:8765/**` in row 2.
4. Click Save URLs.
5. Watch the restart toast.
6. Verify list shows both URLs.
7. Verify: `ssh ubuntu@148.113.1.164 'sudo docker exec supastack-<ref>-auth-1 env | grep URI_ALLOW_LIST'`
   Expected: `GOTRUE_URI_ALLOW_LIST=http://localhost:3000,http://localhost:8765/**`

### Smoke 3: OAuth round-trip (the original motivation)
1. Add `http://localhost:8765/**` to Redirect URLs (smoke 2).
2. Open `scripts/oauth-test/index.html` (served by `python3 -m http.server 8765`).
3. Project URL pre-filled, anon key pre-filled.
4. Click Sign in with GitHub.
5. Authorize on GitHub.
6. Expect: page lands back on `http://localhost:8765/?code=…` (NOT on `https://<ref>.supaviser.dev/?code=…`).
7. Expect: the pill flips to "signed in as <user>" with user metadata pretty-printed.

### Smoke 4: Delete a Redirect URL
1. Click the trash icon next to `http://localhost:3000`.
2. Watch the restart toast.
3. Verify list now shows only `http://localhost:8765/**`.
4. Verify: `sudo docker exec supastack-<ref>-auth-1 env | grep URI_ALLOW_LIST`
   Expected: `GOTRUE_URI_ALLOW_LIST=http://localhost:8765/**`

### Smoke 5: Member RBAC
1. Sign out, sign in as a member of the project's org.
2. Navigate to the URL Configuration page.
3. Expect: page renders, current values visible, Save button hidden, Add URL button hidden, trash icons hidden.

## Validation cheat sheet

| Input on URL field | Expected outcome |
|---|---|
| `http://localhost:3000` | accepted |
| `https://app.example.com` | accepted |
| `http://localhost:*` | accepted (wildcard tolerated) |
| `http://localhost:8765/**` | accepted (wildcard tolerated) |
| `localhost:3000` | rejected (missing scheme) |
| `javascript:alert(1)` | rejected (disallowed scheme) |
| `   ` (whitespace) | rejected (empty after trim) |
| `http://localhost:3000` when already in list | rejected (duplicate) |
| `http://Localhost:3000` when `http://localhost:3000` already in list | rejected (case-insensitive scheme+host dedup) |
| `http://localhost:3000/foo` when `http://localhost:3000/foo/` already in list | accepted (paths byte-exact) |
| 51st URL when 50 already in list | rejected (cap) |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Page loads but Site URL input is empty for an existing project | `site_url` is null in DB | Expected — type your value and save |
| Save button stays disabled after typing | Input fails URL validation | Check scheme, no whitespace |
| Restart toast flips to Retry with red bar | Auth container failed healthcheck after env reload | Most likely a malformed glob in a Redirect URL — delete the most recent entry |
| OAuth still bounces to project URL even after adding `http://localhost:8765/**` | env var didn't propagate | `docker exec supastack-<ref>-auth-1 env | grep URI_ALLOW_LIST` to verify; if missing, the auth-config PATCH didn't run — re-save |
